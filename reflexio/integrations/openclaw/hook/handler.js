// ---------------------------------------------------------------------------
// Security contract — localhost only, HTTP only.
//
// This hook is a localhost-only integration. It buffers OpenClaw conversations
// to a local SQLite database and talks to the Reflexio backend HTTP server on
// the same machine via native fetch(). It does not spawn subprocesses, does
// not read configuration from the filesystem, and does not consult any
// environment variables. The destination is a hardcoded loopback URL.
//
// Traffic: only HTTP requests to http://127.0.0.1:8081/api/* and
// http://127.0.0.1:8081/health. No other hosts are contacted.
//
// Bootstrap: the Reflexio server must be running on port 8081 before the
// hook is useful. If it is not, every fetch() attempt fails gracefully with
// a logged error and the hook returns — the agent continues without
// cross-session memory that session. Starting the server is the user's
// responsibility; the skill's First-Use Setup runs `reflexio services start`
// once at install time.
//
// Writes are confined to ~/.reflexio/sessions.db (SQLite buffer).
// ---------------------------------------------------------------------------

const { randomUUID } = require("node:crypto");
const { mkdirSync } = require("node:fs");
const { homedir } = require("node:os");
const { dirname, join } = require("node:path");

const Database = require("better-sqlite3");

// Hardcoded loopback destination — all traffic goes here, nowhere else.
const LOCAL_SERVER_URL = "http://127.0.0.1:8081";
// Hardcoded agent label; stored alongside extracted playbooks so they are
// scoped to this integration build.
const AGENT_VERSION = "openclaw-agent";

// ---------------------------------------------------------------------------
// HTTP helper — single fetch() path for every API call
// ---------------------------------------------------------------------------

async function apiPost(path, body, timeoutMs = 10_000) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(`${LOCAL_SERVER_URL}${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: ctrl.signal,
		});
		if (!res.ok) {
			throw new Error(`HTTP ${res.status} ${res.statusText}`);
		}
		return await res.json();
	} finally {
		clearTimeout(timer);
	}
}

// Format unified search results (profiles + playbooks) as a markdown block
// the agent can read directly. Kept in sync with the CLI's text output
// shape so the injected bootstrap file looks familiar.
function formatSearchResults(data) {
	const lines = [];
	const profiles = data?.profiles ?? [];
	const userPlaybooks = data?.user_playbooks ?? [];
	const agentPlaybooks = data?.agent_playbooks ?? [];

	if (profiles.length > 0) {
		lines.push("## User Profiles");
		for (const p of profiles) {
			const content = p.profile_content ?? p.content ?? "";
			if (content.trim()) lines.push(`- ${content.trim()}`);
		}
		lines.push("");
	}
	if (userPlaybooks.length > 0) {
		lines.push("## User Playbooks (from this agent's history)");
		for (const pb of userPlaybooks) {
			const summary =
				pb.content ?? pb.instruction ?? pb.trigger ?? JSON.stringify(pb);
			lines.push(`- ${summary}`);
		}
		lines.push("");
	}
	if (agentPlaybooks.length > 0) {
		lines.push("## Agent Playbooks (shared across instances)");
		for (const pb of agentPlaybooks) {
			const summary =
				pb.content ?? pb.instruction ?? pb.trigger ?? JSON.stringify(pb);
			lines.push(`- ${summary}`);
		}
		lines.push("");
	}
	return lines.join("\n").trim();
}

// ---------------------------------------------------------------------------
// SQLite session store — persistent, crash-safe conversation buffer.
// DB lives in ~/.reflexio/sessions.db.
// ---------------------------------------------------------------------------

const DB_PATH = join(homedir(), ".reflexio", "sessions.db");
const MAX_CONTENT_LENGTH = 10_000;
const MAX_INTERACTIONS = 200;
const BATCH_SIZE = 10; // Publish every N complete exchanges mid-session
const MAX_RETRIES = 3; // Give up retrying after this many failures

let _db = null;

function getDb() {
	if (_db) return _db;
	mkdirSync(dirname(DB_PATH), { recursive: true, mode: 0o700 });
	_db = new Database(DB_PATH);
	_db.pragma("journal_mode = WAL");
	// Use prepare().run() for DDL; better-sqlite3 accepts DDL statements
	// through prepared statements the same as DML.
	_db.prepare(
		"CREATE TABLE IF NOT EXISTS turns (" +
			"id INTEGER PRIMARY KEY AUTOINCREMENT, " +
			"session_id TEXT NOT NULL, " +
			"role TEXT NOT NULL, " +
			"content TEXT NOT NULL, " +
			"timestamp TEXT NOT NULL, " +
			"published INTEGER DEFAULT 0, " +
			"retry_count INTEGER DEFAULT 0" +
			")",
	).run();
	_db.prepare(
		"CREATE INDEX IF NOT EXISTS idx_session_published ON turns(session_id, published)",
	).run();
	// Add retry_count column if missing (migration for existing DBs)
	try {
		_db.prepare("ALTER TABLE turns ADD COLUMN retry_count INTEGER DEFAULT 0").run();
	} catch {
		// Column already exists -- ignore
	}
	// Clean up old published turns (keep 7 days)
	_db.prepare(
		"DELETE FROM turns WHERE published = 1 AND timestamp < datetime('now', '-7 days')",
	).run();
	// Graceful close on process exit is intentionally omitted:
	// better-sqlite3 flushes WAL on its own and we avoid referencing the
	// runtime's process object here.
	return _db;
}

// ---------------------------------------------------------------------------
// Smart truncation — preserves head + tail with a marker in between
// ---------------------------------------------------------------------------

function smartTruncate(content, maxLength = MAX_CONTENT_LENGTH) {
	if (!content || content.length <= maxLength) return content || "";
	const headLen = Math.floor(maxLength * 0.8);
	const tailLen = Math.max(0, maxLength - headLen - 80);
	const truncated = content.length - headLen - tailLen;
	const marker = `\n\n[...truncated ${truncated} chars...]\n\n`;
	if (tailLen === 0) return content.slice(0, headLen) + marker;
	return content.slice(0, headLen) + marker + content.slice(-tailLen);
}

// ---------------------------------------------------------------------------
// Session ID resolution
// ---------------------------------------------------------------------------

let _fallbackSessionId = null;

function getSessionId(event) {
	const key = event.context?.sessionKey;
	if (key) return key;
	if (!_fallbackSessionId) {
		_fallbackSessionId = `anon-${randomUUID()}`;
		console.error(
			`[reflexio] No sessionKey; using fallback: ${_fallbackSessionId}`,
		);
	}
	return _fallbackSessionId;
}

// ---------------------------------------------------------------------------
// User ID resolution — multi-agent instance support
//
// Derived entirely from the OpenClaw session key, which encodes the
// per-agent identifier as a prefix of the form "agent:<id>:<rest>".
// When the session key doesn't match that shape, everything falls back to
// the single label "openclaw".
// ---------------------------------------------------------------------------

function resolveUserId(event) {
	const sessionKey = event.context?.sessionKey ?? "";
	const sessionMatch = sessionKey.match(/^agent:([^:]+):/);
	if (sessionMatch) return sessionMatch[1];
	return "openclaw";
}

// ---------------------------------------------------------------------------
// Shared publish logic — POSTs buffered turns to /api/publish_interaction
// ---------------------------------------------------------------------------

async function publishSession(db, sessionId, userId, agentVersion) {
	const turns = db
		.prepare(
			"SELECT id, role, content FROM turns WHERE session_id = ? AND published = 0 AND retry_count < ? ORDER BY id LIMIT ?",
		)
		.all(sessionId, MAX_RETRIES, MAX_INTERACTIONS);

	if (turns.length === 0) return;

	// Mark selected turns as in-flight (published = 2) synchronously to prevent
	// concurrent publishSession calls from picking up the same rows.
	const maxId = turns[turns.length - 1].id;
	db.prepare(
		"UPDATE turns SET published = 2 WHERE session_id = ? AND published = 0 AND retry_count < ? AND id <= ?",
	).run(sessionId, MAX_RETRIES, maxId);

	const body = {
		user_id: userId,
		source: "openclaw",
		agent_version: agentVersion,
		session_id: sessionId,
		interaction_data_list: turns.map((t) => ({
			role: t.role,
			content: t.content,
		})),
		skip_aggregation: false,
		force_extraction: false,
	};

	try {
		await apiPost("/api/publish_interaction", body, 15_000);
		db.prepare(
			"UPDATE turns SET published = 1 WHERE session_id = ? AND published = 2",
		).run(sessionId);
		console.error(
			`[reflexio] Published ${turns.length} interactions (session ${sessionId})`,
		);
	} catch (err) {
		console.error(
			`[reflexio] Publish failed: ${err?.message ?? err}, incrementing retry count`,
		);
		try {
			db.prepare(
				"UPDATE turns SET published = 0, retry_count = retry_count + 1 WHERE session_id = ? AND published = 2",
			).run(sessionId);
		} catch (e) {
			console.error(
				`[reflexio] Failed to update retry count: ${e.message}`,
			);
		}
	}
}

/**
 * Main hook dispatcher for Reflexio-OpenClaw integration.
 *
 * Events handled:
 *   agent:bootstrap   - Inject user profile + retry unpublished sessions
 *   message:received  - Search Reflexio before agent responds
 *   message:sent      - Buffer turn to SQLite + incremental publish
 *   command:stop      - Flush remaining unpublished turns to Reflexio
 */
async function reflexioHook(event) {
	// Skip sub-agent sessions to avoid recursion (guards all event types)
	const sessionKey = event.context?.sessionKey ?? "";
	if (sessionKey.includes(":subagent:")) return;

	const eventKey = `${event.type}:${event.action}`;

	switch (eventKey) {
		case "agent:bootstrap":
			return handleBootstrap(event);
		case "message:received":
			return handleSearchBeforeResponse(event);
		case "message:sent":
			return handleMessageSent(event);
		case "command:stop":
			return handleSessionEnd(event);
	}
}

// ---------------------------------------------------------------------------
// Bootstrap: inject user profile + retry unpublished sessions
//
// Precondition: the Reflexio backend is already running on LOCAL_SERVER_URL.
// The hook does not start it — that's the user's responsibility, handled
// once at install time by the skill's First-Use Setup. If the server is
// unreachable, every API call fails quickly and the handler returns.
// ---------------------------------------------------------------------------

async function handleBootstrap(event) {
	const workspaceDir = event.context?.workspaceDir;
	if (!workspaceDir) return;

	console.error(`[reflexio] bootstrap hook fired, workspace=${workspaceDir}`);

	const userId = resolveUserId(event);
	const currentSessionId = getSessionId(event);

	// --- Inject user profile via unified search ---
	try {
		const data = await apiPost(
			"/api/search",
			{
				query: "communication style, expertise, and preferences",
				user_id: userId,
				top_k: 3,
			},
			10_000,
		);

		const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
		if (profiles.length > 0) {
			const profileLines = profiles
				.map((p) => `- ${(p.profile_content ?? p.content ?? "").trim()}`)
				.filter((line) => line.length > 2);

			if (profileLines.length > 0 && Array.isArray(event.context.bootstrapFiles)) {
				const bootstrapContent = [
					"## About This User (from Reflexio)",
					"",
					...profileLines,
					"",
					'Use `reflexio search "<your current task>"` before starting work to get task-specific behavioral corrections.',
				].join("\n");

				event.context.bootstrapFiles.push({
					name: "REFLEXIO_USER_PROFILE.md",
					path: "REFLEXIO_USER_PROFILE.md",
					content: bootstrapContent,
					source: "hook:reflexio-context",
				});
				console.error(
					`[reflexio] Injected user profile (${bootstrapContent.length} chars)`,
				);
			}
		}
	} catch (err) {
		console.error(
			`[reflexio] Bootstrap profile fetch failed: ${err?.message ?? err}`,
		);
	}

	// --- Retry unpublished turns from previous sessions ---
	try {
		const db = getDb();
		const oldSessions = db
			.prepare(
				"SELECT DISTINCT session_id FROM turns WHERE published = 0 AND retry_count < ? AND session_id != ? LIMIT 5",
			)
			.all(MAX_RETRIES, currentSessionId);

		if (oldSessions.length > 0) {
			console.error(
				`[reflexio] Retrying ${oldSessions.length} unpublished session(s)`,
			);
			for (const { session_id } of oldSessions) {
				// Await sequentially so we don't hammer the server with
				// concurrent publishes for stale sessions.
				// eslint-disable-next-line no-await-in-loop
				await publishSession(db, session_id, userId, AGENT_VERSION);
			}
		}
	} catch (err) {
		console.error(`[reflexio] Retry failed: ${err?.message ?? err}`);
	}
}

// ---------------------------------------------------------------------------
// Message received: search Reflexio before the agent responds
// ---------------------------------------------------------------------------

const TRIVIAL_RESPONSE_RE = /^(yes|no|ok|sure|thanks|y|n)$/i;

async function handleSearchBeforeResponse(event) {
	let prompt = event.context?.userMessage;
	if (!prompt || prompt.length < 5) return;
	if (TRIVIAL_RESPONSE_RE.test(prompt.trim())) return;
	prompt = prompt.slice(0, 4096);

	try {
		const userId = resolveUserId(event);
		const data = await apiPost(
			"/api/search",
			{
				query: prompt,
				user_id: userId,
				top_k: 5,
				agent_version: AGENT_VERSION,
			},
			5_000,
		);

		const formatted = formatSearchResults(data);
		if (formatted && Array.isArray(event.context?.bootstrapFiles)) {
			event.context.bootstrapFiles.push({
				name: "REFLEXIO_CONTEXT.md",
				path: "REFLEXIO_CONTEXT.md",
				content: formatted,
				source: "hook:reflexio-context",
			});
			console.error(
				`[reflexio] Injected search context for message (${formatted.length} chars)`,
			);
		}
	} catch (err) {
		console.error(
			`[reflexio] Per-message search failed: ${err?.message ?? err}`,
		);
		// Server may be down. The skill's First-Use Setup is responsible for
		// starting it; the hook does not launch processes.
	}
}

// ---------------------------------------------------------------------------
// Message sent: buffer turn + incremental publish every BATCH_SIZE exchanges
// ---------------------------------------------------------------------------

function handleMessageSent(event) {
	const userMessage = event.context?.userMessage;
	const agentResponse = event.context?.agentResponse;
	const sessionId = getSessionId(event);

	if (!userMessage && !agentResponse) return;

	try {
		const db = getDb();
		const now = new Date().toISOString();

		const insertTurn = db.transaction((sid, user, agent, ts) => {
			const stmt = db.prepare(
				"INSERT INTO turns (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
			);
			if (user) stmt.run(sid, "user", smartTruncate(user), ts);
			if (agent) stmt.run(sid, "assistant", smartTruncate(agent), ts);
		});
		insertTurn(sessionId, userMessage, agentResponse, now);

		// Incremental publish: every BATCH_SIZE complete exchanges
		const { count } = db
			.prepare(
				"SELECT COUNT(*) as count FROM turns WHERE session_id = ? AND published = 0",
			)
			.get(sessionId);

		if (count >= BATCH_SIZE * 2) {
			const userId = resolveUserId(event);
			void publishSession(db, sessionId, userId, AGENT_VERSION).catch((e) =>
				console.error(`[reflexio] Incremental publish failed: ${e?.message ?? e}`),
			);
		}
	} catch (err) {
		console.error(`[reflexio] Failed to buffer turn: ${err.message}`);
	}
}

// ---------------------------------------------------------------------------
// Session end: flush remaining unpublished turns
// ---------------------------------------------------------------------------

async function handleSessionEnd(event) {
	const sessionId = getSessionId(event);
	const userId = resolveUserId(event);

	try {
		const db = getDb();
		await publishSession(db, sessionId, userId, AGENT_VERSION);
	} catch (err) {
		console.error(`[reflexio] Session flush failed: ${err?.message ?? err}`);
	}
}

// OpenClaw expects a CommonJS default export.
module.exports = reflexioHook;
module.exports.default = reflexioHook;
