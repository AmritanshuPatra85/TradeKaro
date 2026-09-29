-- Controlled integration check for the deployed Supabase function.
-- Before running in Supabase SQL Editor, replace the UUID below with a
-- dedicated test user's UUID. All changes, including test orders/trades, are
-- rolled back at the end. NSE cases require the existing weekday session gate.

BEGIN;
SELECT set_config('tradekaro.test_user_id', 'REPLACE_WITH_DEDICATED_TEST_USER_UUID', true);

DO $test$
DECLARE
  v_user uuid := current_setting('tradekaro.test_user_id')::uuid;
  v_result record;
  v_cash numeric;
  v_qty numeric;
  v_avg numeric;
  v_fill numeric;
  v_market_open boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.portfolios WHERE user_id = v_user) THEN
    RAISE EXCEPTION 'test user % has no portfolio', v_user;
  END IF;

  v_market_open := (
    EXTRACT(dow FROM (now() AT TIME ZONE 'Asia/Kolkata')) BETWEEN 1 AND 5
    AND (now() AT TIME ZONE 'Asia/Kolkata')::time BETWEEN TIME '09:15' AND TIME '15:30'
  );
  IF NOT v_market_open THEN
    RAISE EXCEPTION 'NSE test cases require a weekday between 09:15 and 15:30 Asia/Kolkata';
  END IF;

  -- Reset only the dedicated user's test symbols. The enclosing transaction
  -- restores their original state after every assertion passes.
  DELETE FROM public.holdings
  WHERE user_id = v_user AND (symbol, market) IN (('WIPRO', 'NSE'), ('BTCUSDT', 'CRYPTO'));
  UPDATE public.portfolios SET cash_balance = 10000 WHERE user_id = v_user;

  -- NSE BUY: INR 100 x 10 = INR 1,000.
  SELECT * INTO v_result FROM public.execute_market_order(
    v_user, 'WIPRO', 'NSE', 'BUY', 10, 100, NULL, NULL
  );
  IF v_result.status <> 'FILLED' OR v_result.cash_balance <> 9000
     OR v_result.holding_quantity <> 10 OR v_result.holding_avg_cost <> 100 THEN
    RAISE EXCEPTION 'NSE BUY mismatch: %', row_to_json(v_result);
  END IF;

  -- NSE SELL: INR 120 x 4 = INR 480; remaining average cost stays INR 100.
  SELECT * INTO v_result FROM public.execute_market_order(
    v_user, 'WIPRO', 'NSE', 'SELL', 4, 120, NULL, NULL
  );
  IF v_result.status <> 'FILLED' OR v_result.cash_balance <> 9480
     OR v_result.holding_quantity <> 6 OR v_result.holding_avg_cost <> 100 THEN
    RAISE EXCEPTION 'NSE SELL mismatch: %', row_to_json(v_result);
  END IF;

  -- Insufficient INR for crypto: INR 17,000 required, INR 10,000 available.
  UPDATE public.portfolios SET cash_balance = 10000 WHERE user_id = v_user;
  SELECT * INTO v_result FROM public.execute_market_order(
    v_user, 'BTCUSDT', 'CRYPTO', 'BUY', 2, 100, 85, now()
  );
  SELECT cash_balance INTO v_cash FROM public.portfolios WHERE user_id = v_user;
  IF v_result.status <> 'REJECTED' OR v_cash <> 10000
     OR EXISTS (SELECT 1 FROM public.holdings WHERE user_id = v_user AND symbol = 'BTCUSDT' AND market = 'CRYPTO') THEN
    RAISE EXCEPTION 'crypto insufficient-cash case mutated portfolio/holding state';
  END IF;

  -- Crypto BUY: INR cash uses FX while average cost and trade fill remain USDT.
  UPDATE public.portfolios SET cash_balance = 50000 WHERE user_id = v_user;
  SELECT * INTO v_result FROM public.execute_market_order(
    v_user, 'BTCUSDT', 'CRYPTO', 'BUY', 2, 100, 85, now()
  );
  SELECT quantity, avg_cost INTO v_qty, v_avg FROM public.holdings
  WHERE user_id = v_user AND symbol = 'BTCUSDT' AND market = 'CRYPTO';
  SELECT fill_price INTO v_fill FROM public.trades WHERE id = v_result.trade_id;
  IF v_result.status <> 'FILLED' OR v_result.cash_balance <> 33000
     OR v_qty <> 2 OR v_avg <> 100 OR v_fill <> 100 THEN
    RAISE EXCEPTION 'crypto BUY mismatch: cash %, qty %, avg %, fill %', v_result.cash_balance, v_qty, v_avg, v_fill;
  END IF;

  -- Crypto SELL: INR proceeds use FX; closing the position removes the holding.
  SELECT * INTO v_result FROM public.execute_market_order(
    v_user, 'BTCUSDT', 'CRYPTO', 'SELL', 2, 100, 85, now()
  );
  SELECT cash_balance INTO v_cash FROM public.portfolios WHERE user_id = v_user;
  IF v_result.status <> 'FILLED' OR v_cash <> 50000
     OR EXISTS (SELECT 1 FROM public.holdings WHERE user_id = v_user AND symbol = 'BTCUSDT' AND market = 'CRYPTO') THEN
    RAISE EXCEPTION 'crypto SELL mismatch: cash %', v_cash;
  END IF;
  SELECT fill_price INTO v_fill FROM public.trades WHERE id = v_result.trade_id;
  IF v_fill <> 100 THEN
    RAISE EXCEPTION 'crypto trade fill_price must remain 100 USDT, got %', v_fill;
  END IF;

  -- Insufficient crypto holdings and invalid/missing/stale FX reject without
  -- changing portfolio cash or holdings.
  SELECT * INTO v_result FROM public.execute_market_order(
    v_user, 'BTCUSDT', 'CRYPTO', 'SELL', 1, 100, 85, now()
  );
  SELECT cash_balance INTO v_cash FROM public.portfolios WHERE user_id = v_user;
  IF v_result.status <> 'REJECTED' OR v_cash <> 50000 THEN
    RAISE EXCEPTION 'insufficient-holdings case mutated portfolio state';
  END IF;

  SELECT * INTO v_result FROM public.execute_market_order(
    v_user, 'BTCUSDT', 'CRYPTO', 'BUY', 1, 100, NULL, NULL
  );
  SELECT cash_balance INTO v_cash FROM public.portfolios WHERE user_id = v_user;
  IF v_result.status <> 'REJECTED' OR v_cash <> 50000 THEN
    RAISE EXCEPTION 'missing-FX case mutated portfolio state';
  END IF;

  SELECT * INTO v_result FROM public.execute_market_order(
    v_user, 'BTCUSDT', 'CRYPTO', 'BUY', 1, 100, 85, now() - INTERVAL '2 minutes'
  );
  SELECT cash_balance INTO v_cash FROM public.portfolios WHERE user_id = v_user;
  IF v_result.status <> 'REJECTED' OR v_cash <> 50000 THEN
    RAISE EXCEPTION 'stale-FX case mutated portfolio state';
  END IF;

  RAISE NOTICE 'execute_market_order FX integration assertions passed for test user %', v_user;
END;
$test$;

ROLLBACK;
