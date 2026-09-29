import { randomInt } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { redis } from "../redis";
import { supabaseAdmin } from "../lib/supabase";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { ENTRIES_KEY, PNL_KEY, type LeaderboardEntry } from "../leaderboard/engine";
import { getUsdtInrRate } from "../fx/rate";

const router = Router();
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_ROOM_MEMBERS = 100;
const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RoomRow {
  id: string;
  code: string;
  name: string;
  created_by: string;
  created_at: string;
}

function newRoomCode(): string {
  return Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

function displayName(userId: string): string {
  return `Trader-${userId.slice(0, 4)}`;
}

async function isRoomMember(roomId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("leaderboard_room_members")
    .select("room_id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

router.get("/leaderboard/rooms", requireAuth, async (req: AuthedRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  try {
    const { data: memberships, error: memberError } = await supabaseAdmin
      .from("leaderboard_room_members")
      .select("room_id, joined_at")
      .eq("user_id", userId)
      .order("joined_at", { ascending: false });
    if (memberError) throw memberError;
    const rows = memberships ?? [];
    if (rows.length === 0) return res.json({ rooms: [] });

    const { data: roomRows, error: roomError } = await supabaseAdmin
      .from("leaderboard_rooms")
      .select("id, code, name, created_by, created_at")
      .in("id", rows.map((membership) => membership.room_id));
    if (roomError) throw roomError;
    const byId = new Map((roomRows ?? []).map((room) => [room.id, room as RoomRow]));
    const rooms = rows.flatMap((membership) => {
      const room = byId.get(membership.room_id);
      return room ? [{ ...room, joined_at: membership.joined_at, is_owner: room.created_by === userId }] : [];
    });
    return res.json({ rooms });
  } catch (error) {
    console.error("[leaderboard-rooms] list failed:", error);
    return res.status(500).json({ error: "Could not load private rooms" });
  }
});

router.post("/leaderboard/rooms", requireAuth, async (req: AuthedRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  const rawName = req.body && typeof req.body.name === "string" ? req.body.name.trim() : "Private room";
  if (rawName.length < 1 || rawName.length > 40) {
    return res.status(400).json({ error: "room name must be from 1 to 40 characters" });
  }

  try {
    let room: RoomRow | null = null;
    for (let attempt = 0; attempt < 5 && !room; attempt++) {
      const { data, error } = await supabaseAdmin
        .from("leaderboard_rooms")
        .insert({ code: newRoomCode(), name: rawName, created_by: userId })
        .select("id, code, name, created_by, created_at")
        .single();
      if (!error) {
        room = data as RoomRow;
        break;
      }
      if (error.code !== "23505") throw error;
    }
    if (!room) throw new Error("Could not allocate a unique room code");

    const { error: memberError } = await supabaseAdmin
      .from("leaderboard_room_members")
      .insert({ room_id: room.id, user_id: userId });
    if (memberError) {
      await supabaseAdmin.from("leaderboard_rooms").delete().eq("id", room.id);
      throw memberError;
    }
    return res.status(201).json({ room: { ...room, is_owner: true, member_count: 1 } });
  } catch (error) {
    console.error("[leaderboard-rooms] create failed:", error);
    return res.status(500).json({ error: "Could not create private room" });
  }
});

router.post("/leaderboard/rooms/join", requireAuth, async (req: AuthedRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  const code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase().replace(/[\s-]/g, "") : "";
  if (!/^[A-Z2-9]{8}$/.test(code)) return res.status(400).json({ error: "Enter an 8-character room code" });

  try {
    const { data: room, error: roomError } = await supabaseAdmin
      .from("leaderboard_rooms")
      .select("id, code, name, created_by, created_at")
      .eq("code", code)
      .maybeSingle();
    if (roomError) throw roomError;
    if (!room) return res.status(404).json({ error: "No private room matches that code" });

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("leaderboard_room_members")
      .select("user_id")
      .eq("room_id", room.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return res.json({ room: { ...room, is_owner: room.created_by === userId }, already_joined: true });

    const { count, error: countError } = await supabaseAdmin
      .from("leaderboard_room_members")
      .select("user_id", { count: "exact", head: true })
      .eq("room_id", room.id);
    if (countError) throw countError;
    if ((count ?? 0) >= MAX_ROOM_MEMBERS) return res.status(409).json({ error: "This room has reached its 100-member limit" });

    const { error: insertError } = await supabaseAdmin
      .from("leaderboard_room_members")
      .insert({ room_id: room.id, user_id: userId });
    if (insertError) throw insertError;
    return res.status(200).json({ room: { ...room, is_owner: room.created_by === userId }, already_joined: false });
  } catch (error) {
    console.error("[leaderboard-rooms] join failed:", error);
    return res.status(500).json({ error: "Could not join private room" });
  }
});

router.get("/leaderboard/rooms/:roomId", requireAuth, async (req: AuthedRequest, res: Response) => {
  const userId = req.userId;
  const roomId = req.params.roomId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  if (!ROOM_ID_PATTERN.test(roomId)) return res.status(400).json({ error: "Invalid room id" });

  try {
    if (!(await isRoomMember(roomId, userId))) return res.status(404).json({ error: "Private room not found" });
    const [roomResult, membersResult, fxRate] = await Promise.all([
      supabaseAdmin.from("leaderboard_rooms").select("id, code, name, created_by, created_at").eq("id", roomId).maybeSingle(),
      supabaseAdmin.from("leaderboard_room_members").select("user_id").eq("room_id", roomId),
      getUsdtInrRate(),
    ]);
    if (roomResult.error || membersResult.error) throw roomResult.error ?? membersResult.error;
    if (!roomResult.data) return res.status(404).json({ error: "Private room not found" });
    if (!fxRate) return res.status(503).json({ error: "USDT/INR conversion quote is unavailable or stale; room valuation is temporarily unavailable" });

    const members = membersResult.data ?? [];
    const pipeline = redis.pipeline();
    for (const member of members) {
      pipeline.zscore(PNL_KEY, member.user_id);
      pipeline.hget(ENTRIES_KEY, member.user_id);
    }
    const results = await pipeline.exec();
    const ranked = members.flatMap((member, index) => {
      const scoreRaw = results?.[index * 2]?.[1];
      const entryRaw = results?.[index * 2 + 1]?.[1];
      if (typeof scoreRaw !== "string" || typeof entryRaw !== "string") return [];
      try {
        const entry = JSON.parse(entryRaw) as LeaderboardEntry;
        return [{ user_id: member.user_id, score: Number(scoreRaw), ...entry }];
      } catch {
        return [];
      }
    }).sort((left, right) => right.score - left.score || left.user_id.localeCompare(right.user_id));

    const leaderboard = ranked.map((entry, index) => ({
      rank: index + 1,
      display_name: entry.display_name || displayName(entry.user_id),
      total_value: entry.total_value,
      pnl: entry.pnl,
      pnl_pct: entry.pnl_pct,
      is_you: entry.user_id === userId,
    }));
    return res.json({
      room: { ...roomResult.data, is_owner: roomResult.data.created_by === userId, member_count: members.length },
      base_currency: "INR",
      fx_rate: fxRate,
      leaderboard,
      total_users: members.length,
      updated_at: Date.now(),
    });
  } catch (error) {
    console.error("[leaderboard-rooms] ranking failed:", error);
    return res.status(500).json({ error: "Could not load private leaderboard" });
  }
});

export default router;
