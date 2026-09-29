-- Keep market fill prices in their quote currency while debiting/crediting INR.
-- The API obtains p_fx_usdt_inr and its timestamp from the existing validated
-- Redis FX provider. This SECURITY DEFINER function rechecks the quote freshness
-- and performs all balance/holding/order/trade changes atomically.

REVOKE EXECUTE ON FUNCTION public.execute_market_order(uuid, text, text, text, numeric, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.execute_market_order(
  p_user_id uuid,
  p_symbol text,
  p_market text,
  p_side text,
  p_quantity numeric,
  p_fill_price numeric,
  p_fx_usdt_inr numeric,
  p_fx_timestamp timestamptz
)
RETURNS TABLE(
  order_id uuid,
  trade_id uuid,
  status text,
  cash_balance numeric,
  holding_quantity numeric,
  holding_avg_cost numeric,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_trade_id uuid;
  v_cash numeric;
  v_quote_cost numeric;
  v_cash_cost numeric;
  v_fx numeric;
  v_existing_qty numeric;
  v_existing_avg numeric;
  v_new_qty numeric;
  v_new_avg numeric;
  v_market_open boolean;
  v_rejection text;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'quantity must be positive';
  END IF;
  IF p_side IS NULL OR p_side NOT IN ('BUY', 'SELL') THEN
    RAISE EXCEPTION 'invalid side: %', p_side;
  END IF;
  IF p_market IS NULL OR p_market NOT IN ('NSE', 'CRYPTO') THEN
    RAISE EXCEPTION 'invalid market: %', p_market;
  END IF;
  IF p_fill_price IS NULL OR p_fill_price <= 0 OR p_fill_price::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'invalid fill price';
  END IF;

  -- Preserve the deployed NSE session gate; crypto remains open 24/7.
  IF p_market = 'NSE' THEN
    v_market_open := (
      EXTRACT(dow FROM (now() AT TIME ZONE 'Asia/Kolkata')) BETWEEN 1 AND 5
      AND (now() AT TIME ZONE 'Asia/Kolkata')::time BETWEEN TIME '09:15' AND TIME '15:30'
    );
    IF NOT v_market_open THEN
      INSERT INTO public.orders (user_id, symbol, market, side, quantity, status)
      VALUES (p_user_id, p_symbol, p_market, p_side, p_quantity, 'REJECTED')
      RETURNING id INTO v_order_id;
      RETURN QUERY SELECT v_order_id, NULL::uuid, 'REJECTED'::text, NULL::numeric, NULL::numeric, NULL::numeric, 'market is closed'::text;
      RETURN;
    END IF;
  END IF;

  -- NSE is INR quoted. Crypto fills stay in USDT and require the provider quote.
  IF p_market = 'CRYPTO' THEN
    IF p_fx_usdt_inr IS NULL
       OR p_fx_usdt_inr <= 0
       OR p_fx_usdt_inr::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_fx_timestamp IS NULL
       OR p_fx_timestamp > now() + INTERVAL '5 seconds'
       OR p_fx_timestamp < now() - INTERVAL '90 seconds' THEN
      INSERT INTO public.orders (user_id, symbol, market, side, quantity, status)
      VALUES (p_user_id, p_symbol, p_market, p_side, p_quantity, 'REJECTED')
      RETURNING id INTO v_order_id;
      RETURN QUERY SELECT v_order_id, NULL::uuid, 'REJECTED'::text, NULL::numeric, NULL::numeric, NULL::numeric,
        'USDT/INR conversion quote is unavailable or stale'::text;
      RETURN;
    END IF;
    v_fx := p_fx_usdt_inr;
  ELSE
    v_fx := 1;
  END IF;

  -- Lock portfolio first so concurrent orders for this user serialize before
  -- reading or creating a position.
  SELECT pf.cash_balance INTO v_cash
  FROM public.portfolios AS pf
  WHERE pf.user_id = p_user_id
  FOR UPDATE;
  IF v_cash IS NULL THEN
    RAISE EXCEPTION 'portfolio not found for user %', p_user_id;
  END IF;

  v_quote_cost := p_quantity * p_fill_price;
  v_cash_cost := v_quote_cost * v_fx;

  SELECT h.quantity, h.avg_cost INTO v_existing_qty, v_existing_avg
  FROM public.holdings AS h
  WHERE h.user_id = p_user_id AND h.symbol = p_symbol AND h.market = p_market
  FOR UPDATE;

  IF p_side = 'BUY' THEN
    IF v_cash < v_cash_cost THEN
      v_rejection := 'insufficient INR balance';
    ELSE
      v_cash := v_cash - v_cash_cost;
      IF v_existing_qty IS NULL THEN
        v_new_qty := p_quantity;
        v_new_avg := p_fill_price;
        INSERT INTO public.holdings (user_id, symbol, market, quantity, avg_cost)
        VALUES (p_user_id, p_symbol, p_market, v_new_qty, v_new_avg);
      ELSE
        v_new_qty := v_existing_qty + p_quantity;
        -- avg_cost and trade.fill_price remain in the instrument quote currency.
        v_new_avg := ((v_existing_qty * v_existing_avg) + v_quote_cost) / v_new_qty;
        UPDATE public.holdings
        SET quantity = v_new_qty, avg_cost = v_new_avg, updated_at = now()
        WHERE user_id = p_user_id AND symbol = p_symbol AND market = p_market;
      END IF;
    END IF;
  ELSE
    IF v_existing_qty IS NULL OR v_existing_qty < p_quantity THEN
      v_rejection := 'insufficient holdings';
    ELSE
      v_cash := v_cash + v_cash_cost;
      v_new_qty := v_existing_qty - p_quantity;
      v_new_avg := v_existing_avg;
      IF v_new_qty = 0 THEN
        DELETE FROM public.holdings
        WHERE user_id = p_user_id AND symbol = p_symbol AND market = p_market;
      ELSE
        UPDATE public.holdings SET quantity = v_new_qty, updated_at = now()
        WHERE user_id = p_user_id AND symbol = p_symbol AND market = p_market;
      END IF;
    END IF;
  END IF;

  IF v_rejection IS NOT NULL THEN
    INSERT INTO public.orders (user_id, symbol, market, side, quantity, status)
    VALUES (p_user_id, p_symbol, p_market, p_side, p_quantity, 'REJECTED')
    RETURNING id INTO v_order_id;
    RETURN QUERY SELECT v_order_id, NULL::uuid, 'REJECTED'::text,
      (SELECT pf.cash_balance FROM public.portfolios AS pf WHERE pf.user_id = p_user_id),
      v_existing_qty, v_existing_avg, v_rejection;
    RETURN;
  END IF;

  UPDATE public.portfolios SET cash_balance = v_cash, updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.orders (user_id, symbol, market, side, quantity, status)
  VALUES (p_user_id, p_symbol, p_market, p_side, p_quantity, 'FILLED')
  RETURNING id INTO v_order_id;

  INSERT INTO public.trades (order_id, user_id, symbol, market, side, quantity, fill_price)
  VALUES (v_order_id, p_user_id, p_symbol, p_market, p_side, p_quantity, p_fill_price)
  RETURNING id INTO v_trade_id;

  RETURN QUERY SELECT v_order_id, v_trade_id, 'FILLED'::text, v_cash, v_new_qty, v_new_avg, NULL::text;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.execute_market_order(uuid, text, text, text, numeric, numeric, numeric, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_market_order(uuid, text, text, text, numeric, numeric, numeric, timestamptz)
  TO service_role;
