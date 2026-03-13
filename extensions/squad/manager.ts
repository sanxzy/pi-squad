/**
 * Squad Extension - Lifecycle Manager
 *
 * Manages squad member subprocesses: spawning, JSONL communication,
 * lifecycle control (start, prompt, abort, destroy), and session management.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { SquadMemberConfig } from "./loader";

/**
 * Possible status values for a squad member instance.
 */
export type MemberStatus = "idle" | "spawning" | "running" | "completed" | "error" | "aborted" | "timeout";

/**
 * Represents a running squad member instance.
 */
export interface SquadMemberInstance {
	/** Config from discovery */
	config: SquadMemberConfig;

	/** Spawned child process (null before spawn) */
	proc: ChildProcess | null;

	/** Current status */
	status: MemberStatus;

	/** Session file path */
	sessionFile: string;

	/** Accumulated output from the last prompt */
	output: string;

	/** Error message if status is "error" */
	error: string | undefined;

	/** JSONL line buffer for incomplete lines */
	buffer: string;

	/** Timestamp when the current task started */
	startedAt: number | undefined;

	/** The prompt that was sent */
	lastPrompt: string | undefined;
}

/**
 * Result from dispatching a prompt to a squad member.
 */
export interface SquadDispatchResult {
	role: string;
	status: MemberStatus;
	output: string;
	error: string | undefined;
	durationMs: number;
}

/**
 * Options for SquadManager constructor.
 */
export interface SquadManagerOptions {
	/** Callback invoked when a member's status changes */
	onStatusChange?: (role: string, status: MemberStatus) => void;

	/** Callback invoked when a member produces output */
	onOutput?: (role: string, output: string) => void;
}

/**
 * Manages squad member subprocesses.
 *
 * Responsibilities:
 * - Spawn squad members as independent pi subprocesses in RPC mode
 * - Send prompts via JSONL protocol over stdin
 * - Receive streaming events over stdout
 * - Track status and accumulate output
 * - Handle timeouts, errors, and aborts
 * - Manage session files per member
 */
export class SquadManager {
	private members: Map<string, SquadMemberInstance> = new Map();
	private sessionDir: string;
	private onStatusChange: ((role: string, status: MemberStatus) => void) | undefined;
	private onOutput: ((role: string, output: string) => void) | undefined;

	/**
	 * Create a new SquadManager.
	 *
	 * @param cwd - Current working directory for spawned processes
	 * @param options - Optional callbacks for status changes and output
	 */
	constructor(
		private cwd: string,
		options?: SquadManagerOptions,
	) {
		this.sessionDir = join(cwd, ".pi", "squad", "sessions");
		if (!existsSync(this.sessionDir)) {
			mkdirSync(this.sessionDir, { recursive: true });
		}
		this.onStatusChange = options?.onStatusChange;
		this.onOutput = options?.onOutput;
	}

	/**
	 * Load squad member configs into the manager.
	 * Does NOT spawn processes — just registers them.
	 *
	 * @param configs - Array of squad member configurations from loader
	 */
	loadMembers(configs: SquadMemberConfig[]): void {
		// Destroy any existing members first
		this.destroyAll();

		for (const config of configs) {
			const sessionFile = join(this.sessionDir, `${config.role}.json`);

			this.members.set(config.role, {
				config,
				proc: null,
				status: "idle",
				sessionFile,
				output: "",
				error: undefined,
				buffer: "",
				startedAt: undefined,
				lastPrompt: undefined,
			});
		}
	}

	/**
	 * Spawn a single squad member subprocess in RPC mode.
	 * Returns immediately — the process runs in the background.
	 *
	 * @param member - The member instance to spawn
	 */
	private spawnMember(member: SquadMemberInstance): void {
		const { config } = member;

		// Build CLI arguments
		const args: string[] = [
			"--mode",
			"rpc",
			"--session",
			member.sessionFile,
			"--system-prompt",
			config.systemPrompt,
			"--auto-compaction",
		];

		// Model
		if (config.model) {
			args.push("--model", config.model);
		}

		// Tools
		if (config.tools) {
			args.push("--tools", config.tools);
		}

		// Thinking
		if (config.thinking && config.thinking !== "off") {
			args.push("--thinking", config.thinking);
		} else {
			args.push("--thinking", "off");
		}

		// Extensions
		if (config.noExtensions) {
			args.push("--no-extensions");
		} else {
			for (const ext of config.extensions) {
				args.push("--extension", ext);
			}
		}

		// Spawn
		const proc = spawn("pi", args, {
			stdio: ["pipe", "pipe", "pipe"],
			cwd: this.cwd,
			env: { ...process.env, ...config.env },
		});

		member.proc = proc;
		member.buffer = "";

		// Handle stdout (JSONL events)
		proc.stdout!.on("data", (chunk: Buffer) => {
			this.handleStdout(member, chunk);
		});

		// Handle stderr (log to console for debugging)
		proc.stderr!.on("data", () => {
			// stderr is for debugging; not surfaced to user
			// Could be logged to a file if verbose mode is on
		});

		// Handle process exit
		proc.on("close", (code: number | null) => {
			if (member.status === "running" || member.status === "spawning") {
				if (code !== 0) {
					member.status = "error";
					member.error = `Process exited with code ${code}`;
				} else {
					member.status = "completed";
				}
				this.onStatusChange?.(member.config.role, member.status);
			}
			member.proc = null;
		});

		proc.on("error", (err: Error) => {
			member.status = "error";
			member.error = `Spawn failed: ${err.message}`;
			member.proc = null;
			this.onStatusChange?.(member.config.role, member.status);
		});
	}

	/**
	 * Handle stdout data from a member subprocess.
	 * Parses JSONL events and tracks agent_end for completion.
	 *
	 * @param member - The member instance
	 * @param chunk - Buffer chunk from stdout
	 */
	private handleStdout(member: SquadMemberInstance, chunk: Buffer): void {
		member.buffer += chunk.toString();
		const lines = member.buffer.split("\n");
		member.buffer = lines.pop() || ""; // Keep incomplete last line

		for (const line of lines) {
			if (!line.trim()) continue;

			try {
				const event = JSON.parse(line);
				this.handleEvent(member, event);
			} catch {
				// Ignore non-JSON output (e.g., startup messages)
			}
		}
	}

	/**
	 * Handle a parsed JSONL event from a member subprocess.
	 *
	 * @param member - The member instance
	 * @param event - Parsed event object
	 */
	private handleEvent(member: SquadMemberInstance, event: any): void {
		switch (event.type) {
			case "agent_start":
				member.status = "running";
				this.onStatusChange?.(member.config.role, "running");
				break;

			case "message_update":
				if (event.assistantMessageEvent?.type === "text_delta") {
					const delta = event.assistantMessageEvent.delta || "";
					member.output += delta;
					this.onOutput?.(member.config.role, delta);
				}
				break;

			case "agent_end":
				member.status = "completed";
				this.onStatusChange?.(member.config.role, "completed");
				break;

			case "extension_ui_request":
				// Auto-cancel any UI requests from subprocess extensions
				// (squad members run headless — no interactive UI)
				if (event.method !== "notify") {
					this.sendToMember(member, {
						type: "extension_ui_response",
						id: event.id,
						cancelled: true,
					});
				}
				break;
		}
	}

	/**
	 * Send a JSON command to a member's stdin.
	 *
	 * @param member - The member instance
	 * @param command - Command object to send
	 */
	private sendToMember(member: SquadMemberInstance, command: Record<string, any>): void {
		if (!member.proc || member.proc.killed) return;
		try {
			member.proc.stdin!.write(`${JSON.stringify(command)}\n`);
		} catch {
			// Ignore write errors (process may have closed)
		}
	}

	/**
	 * Dispatch a prompt to ALL squad members simultaneously.
	 * Returns a Promise that resolves when ALL members complete (or timeout).
	 * Does NOT block the main agent session.
	 *
	 * @param prompt - The prompt to send to all members
	 * @returns Array of dispatch results from all members
	 */
	async dispatchAll(prompt: string): Promise<SquadDispatchResult[]> {
		const promises: Promise<SquadDispatchResult>[] = [];

		for (const [role] of this.members) {
			promises.push(this.dispatchOne(role, prompt));
		}

		return Promise.all(promises);
	}

	/**
	 * Dispatch a prompt to a single squad member.
	 * Spawns the process if not already spawned.
	 *
	 * @param role - The role identifier of the member
	 * @param prompt - The prompt to send
	 * @returns Dispatch result with status, output, and duration
	 */
	async dispatchOne(role: string, prompt: string): Promise<SquadDispatchResult> {
		const member = this.members.get(role);
		if (!member) {
			return {
				role,
				status: "error",
				output: "",
				error: `Unknown squad member: ${role}`,
				durationMs: 0,
			};
		}

		// Reset state for new dispatch
		member.output = "";
		member.error = undefined;
		member.lastPrompt = prompt;
		member.startedAt = Date.now();
		member.status = "spawning";
		this.onStatusChange?.(role, "spawning");

		// Spawn if not already running
		if (!member.proc || member.proc.killed) {
			this.spawnMember(member);
		}

		// Send the prompt
		// Small delay to let subprocess initialize
		await sleep(500);
		this.sendToMember(member, {
			type: "prompt",
			message: prompt,
		});

		// Wait for completion or timeout
		return new Promise<SquadDispatchResult>((resolve) => {
			const timeout = member.config.timeout;
			let resolved = false;

			const timer = setTimeout(() => {
				if (!resolved) {
					resolved = true;
					member.status = "timeout";
					this.onStatusChange?.(role, "timeout");
					// Abort the subprocess
					this.sendToMember(member, { type: "abort" });
					resolve({
						role,
						status: "timeout",
						output: member.output,
						error: `Timed out after ${timeout}ms`,
						durationMs: Date.now() - member.startedAt!,
					});
				}
			}, timeout);

			// Poll for completion
			const interval = setInterval(() => {
				if (resolved) {
					clearInterval(interval);
					return;
				}

				if (member.status === "completed" || member.status === "error") {
					resolved = true;
					clearTimeout(timer);
					clearInterval(interval);
					resolve({
						role,
						status: member.status,
						output: member.output,
						error: member.error,
						durationMs: Date.now() - member.startedAt!,
					});
				}
			}, 100);
		});
	}

	/**
	 * Abort a specific member's current task.
	 *
	 * @param role - The role identifier of the member to abort
	 */
	abort(role: string): void {
		const member = this.members.get(role);
		if (!member) return;
		this.sendToMember(member, { type: "abort" });
		member.status = "aborted";
		this.onStatusChange?.(role, "aborted");
	}

	/**
	 * Abort ALL running members.
	 */
	abortAll(): void {
		for (const [role] of this.members) {
			this.abort(role);
		}
	}

	/**
	 * Destroy a specific member's subprocess.
	 *
	 * @param role - The role identifier of the member to destroy
	 */
	destroy(role: string): void {
		const member = this.members.get(role);
		if (!member) return;

		if (member.proc && !member.proc.killed) {
			member.proc.kill("SIGTERM");
		}
		member.proc = null;
		member.status = "idle";
		this.members.delete(role);
	}

	/**
	 * Destroy ALL subprocesses.
	 */
	destroyAll(): void {
		for (const [role] of this.members) {
			this.destroy(role);
		}
		this.members.clear();
	}

	/**
	 * Get all member instances for status display.
	 *
	 * @returns Map of role to member instance
	 */
	getMembers(): Map<string, SquadMemberInstance> {
		return this.members;
	}

	/**
	 * Get a specific member instance.
	 *
	 * @param role - The role identifier
	 * @returns The member instance or undefined
	 */
	getMember(role: string): SquadMemberInstance | undefined {
		return this.members.get(role);
	}

	/**
	 * Get all member roles.
	 *
	 * @returns Array of role identifiers
	 */
	getRoles(): string[] {
		return Array.from(this.members.keys());
	}

	/**
	 * Check if all members are idle or completed.
	 *
	 * @returns True if no members are running or spawning
	 */
	isAllDone(): boolean {
		for (const member of this.members.values()) {
			if (member.status === "running" || member.status === "spawning") {
				return false;
			}
		}
		return true;
	}

	/**
	 * Graceful shutdown: send abort to all running members,
	 * wait briefly, then force kill.
	 */
	async gracefulShutdown(): Promise<void> {
		// First, abort all running members
		for (const member of this.members.values()) {
			if (member.proc && !member.proc.killed) {
				if (member.status === "running" || member.status === "spawning") {
					this.sendToMember(member, { type: "abort" });
				}
			}
		}

		// Wait briefly for graceful exit
		await sleep(500);

		// Force kill any remaining
		for (const member of this.members.values()) {
			if (member.proc && !member.proc.killed) {
				member.proc.kill("SIGTERM");
			}
			member.proc = null;
		}

		this.members.clear();
	}

	/**
	 * Clean up old session files that are older than maxAge.
	 *
	 * @param maxAge - Maximum age in milliseconds (default: 7 days)
	 */
	cleanupOldSessions(maxAge: number = 7 * 24 * 60 * 60 * 1000): void {
		if (!existsSync(this.sessionDir)) return;

		const now = Date.now();
		const files = readdirSync(this.sessionDir);

		for (const file of files) {
			const filePath = join(this.sessionDir, file);
			try {
				const stats = statSync(filePath);
				if (now - stats.mtimeMs > maxAge) {
					unlinkSync(filePath);
				}
			} catch {
				// Ignore errors during cleanup
			}
		}
	}
}

/**
 * Sleep for a specified duration.
 *
 * @param ms - Duration in milliseconds
 * @returns Promise that resolves after the duration
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
