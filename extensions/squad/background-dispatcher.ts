/**
 * Squad Extension - Background Dispatcher
 *
 * Implements fire-and-forget pattern for non-blocking squad member dispatch.
 * Tasks run in background and notify parent session on completion.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { SquadDispatchResult, SquadManager } from "./manager";

/**
 * Background dispatch task tracking.
 */
export interface BackgroundDispatchTask {
	/** Unique task ID */
	id: string;
	/** Parent session ID */
	parentSessionID: string;
	/** Parent message ID */
	parentMessageID: string;
	/** Prompts sent to each member */
	prompts: Record<string, string>;
	/** Results from each member */
	results: Map<string, SquadDispatchResult>;
	/** Task status */
	status: "pending" | "running" | "completed" | "error";
	/** When task was started */
	startedAt: number;
	/** When task completed */
	completedAt?: number;
}

/**
 * Background dispatcher for non-blocking squad operations.
 */
export class BackgroundDispatcher {
	/** Active background tasks */
	private tasks: Map<string, BackgroundDispatchTask> = new Map();
	/** Polling interval in ms */
	private readonly POLL_INTERVAL = 3000;
	/** Task timeout in ms (30 minutes) */
	private readonly TASK_TIMEOUT = 30 * 60 * 1000;
	/** Polling timer */
	private pollTimer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private manager: SquadManager,
		private ctx: ExtensionContext,
		private pi: ExtensionAPI,
	) {}

	/**
	 * Start polling for task completion.
	 */
	startPolling(): void {
		if (this.pollTimer) return;

		this.pollTimer = setInterval(() => {
			this.pollTasks();
		}, this.POLL_INTERVAL);
	}

	/**
	 * Stop polling.
	 */
	stopPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	/**
	 * Dispatch to all squad members in background (non-blocking).
	 *
	 * @param prompt - Prompt to send to all members
	 * @param parentSessionID - Parent session ID for notification
	 * @param parentMessageID - Parent message ID for notification
	 * @returns Task ID for tracking
	 */
	dispatchAllBackground(prompt: string, parentSessionID: string, parentMessageID: string): string {
		const taskId = `squad_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const members = this.manager.getMembers();

		// Create task record
		const task: BackgroundDispatchTask = {
			id: taskId,
			parentSessionID,
			parentMessageID,
			prompts: {},
			results: new Map(),
			status: "pending",
			startedAt: Date.now(),
		};

		// Dispatch to each member
		for (const [role] of members) {
			task.prompts[role] = prompt;
			// Fire-and-forget: don't await
			this.manager.dispatchOne(role, prompt).then((result) => {
				task.results.set(role, result);
				this.checkTaskCompletion(task);
			});
		}

		this.tasks.set(taskId, task);
		this.startPolling();

		return taskId;
	}

	/**
	 * Dispatch custom prompts to different members in background.
	 *
	 * @param prompts - Map of role to prompt
	 * @param parentSessionID - Parent session ID for notification
	 * @param parentMessageID - Parent message ID for notification
	 * @returns Task ID for tracking
	 */
	dispatchCustomBackground(prompts: Record<string, string>, parentSessionID: string, parentMessageID: string): string {
		const taskId = `squad_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const roles = Object.keys(prompts);

		// Create task record
		const task: BackgroundDispatchTask = {
			id: taskId,
			parentSessionID,
			parentMessageID,
			prompts,
			results: new Map(),
			status: "pending",
			startedAt: Date.now(),
		};

		// Dispatch to each member with their custom prompt
		for (const role of roles) {
			// Fire-and-forget: don't await
			this.manager.dispatchOne(role, prompts[role]).then((result) => {
				task.results.set(role, result);
				this.checkTaskCompletion(task);
			});
		}

		this.tasks.set(taskId, task);
		this.startPolling();

		return taskId;
	}

	/**
	 * Check if a task is complete and notify parent.
	 */
	private checkTaskCompletion(task: BackgroundDispatchTask): void {
		if (task.status === "completed" || task.status === "error") return;

		const expectedCount = Object.keys(task.prompts).length;
		const receivedCount = task.results.size;

		if (receivedCount >= expectedCount) {
			task.status = "completed";
			task.completedAt = Date.now();
			this.notifyParent(task);
		}
	}

	/**
	 * Poll all active tasks for completion/timeout.
	 */
	private pollTasks(): void {
		const now = Date.now();

		for (const task of this.tasks.values()) {
			if (task.status === "completed") continue;

			// Check timeout
			if (now - task.startedAt > this.TASK_TIMEOUT) {
				task.status = "error";
				task.completedAt = now;
				this.notifyParent(task, true);
				continue;
			}

			// Check if all members are done
			this.checkTaskCompletion(task);
		}

		// Stop polling if no active tasks
		const hasActiveTasks = Array.from(this.tasks.values()).some((t) => t.status !== "completed");
		if (!hasActiveTasks) {
			this.stopPolling();
		}
	}

	/**
	 * Notify parent session of task completion.
	 */
	private notifyParent(task: BackgroundDispatchTask, isTimeout = false): void {
		const results = Array.from(task.results.values());
		const completedCount = results.filter((r) => r.status === "completed").length;
		const failedCount = results.filter((r) => r.status !== "completed").length;
		const duration = ((task.completedAt! - task.startedAt) / 1000).toFixed(1);

		// Build notification message
		let message = `✅ **Squad Task Complete** (${duration}s)\n\n`;

		if (isTimeout) {
			message += "⚠️ Task timed out\n\n";
		}

		message += `**Task ID:** ${task.id}\n`;
		message += `**Results:** ${completedCount} completed, ${failedCount} failed\n\n`;

		for (const result of results) {
			const icon = result.status === "completed" ? "✓" : "✗";
			message += `${icon} **${result.role}** (${(result.durationMs / 1000).toFixed(1)}s)\n`;

			if (result.error) {
				message += `  Error: ${result.error}\n`;
			} else if (result.output) {
				const preview = result.output.slice(0, 300);
				message += `  ${preview}${result.output.length > 300 ? "..." : ""}\n`;
			}
			message += "\n";
		}

		message += `Use \`squad get_completed_outputs "${task.id}"\` to retrieve full outputs.`;

		// Inject into chat as a system message that triggers agent turn
		this.ctx.ui.notify(`Squad task complete: ${completedCount}/${results.length} members`, "info");

		// Also inject as a custom message that TRIGGERS agent turn
		this.pi.sendMessage(
			{
				customType: "squad-task-complete",
				content: message,
				display: true,
			},
			{ triggerTurn: true }, // TRIGGER agent to wake up and retrieve outputs
		);
	}

	/**
	 * Dispatch to a single squad member in background with agent notification.
	 *
	 * @param role - Role of the squad member
	 * @param prompt - Prompt to send
	 * @param parentSessionID - Parent session ID for notification
	 * @param parentMessageID - Parent message ID for notification
	 * @returns Task ID for tracking
	 */
	dispatchOneBackground(role: string, prompt: string, parentSessionID: string, parentMessageID: string): string {
		const taskId = `squad_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

		// Create task record
		const task: BackgroundDispatchTask = {
			id: taskId,
			parentSessionID,
			parentMessageID,
			prompts: { [role]: prompt },
			results: new Map(),
			status: "pending",
			startedAt: Date.now(),
		};

		// Dispatch to the member - fire-and-forget
		this.manager.dispatchOne(role, prompt).then((result) => {
			task.results.set(role, result);
			task.status = result.status === "completed" ? "completed" : "error";
			task.completedAt = Date.now();
			this.notifyParent(task);
		});

		this.tasks.set(taskId, task);
		this.startPolling();

		return taskId;
	}

	/**
	 * Get task by ID.
	 */
	getTask(taskId: string): BackgroundDispatchTask | undefined {
		return this.tasks.get(taskId);
	}

	/**
	 * Get all active tasks.
	 */
	getActiveTasks(): BackgroundDispatchTask[] {
		return Array.from(this.tasks.values()).filter((t) => t.status !== "completed");
	}

	/**
	 * Cleanup completed tasks older than timeout.
	 */
	cleanup(): void {
		const now = Date.now();
		for (const [id, task] of this.tasks.entries()) {
			if (task.status === "completed" && task.completedAt && now - task.completedAt > this.TASK_TIMEOUT) {
				this.tasks.delete(id);
			}
		}
	}
}
