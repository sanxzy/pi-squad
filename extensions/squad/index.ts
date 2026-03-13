/**
 * Squad Extension - Main Entry Point with Non-Blocking Dispatch
 *
 * Key Feature: broadcast and parallel_dispatch actions are NON-BLOCKING
 * They return immediately with a task ID and notify when complete.
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem, OverlayHandle } from "@mariozechner/pi-tui";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { BackgroundDispatcher } from "./background-dispatcher";
import { discoverSquadMembers, type SquadMemberConfig, validateAllSquadMembers, validateSquadMember } from "./loader";
import { type MemberStatus, SquadManager } from "./manager";
import { SquadOverlay, type SquadOverlayCallbacks } from "./overlay";

interface SquadToolDetails {
	action: string;
	taskId?: string;
	results?: Array<{ role: string; status: string; durationMs: number; outputLength: number; outputPreview?: string }>;
	members?: string[];
	role?: string;
	status?: string;
	all?: boolean;
	dispatching?: string[];
	dispatched?: string[];
	memberStatuses?: Array<{ role: string; status: string }>;
	durationMs?: number;
	outputLength?: number;
}

interface SquadState {
	lastResults: Map<string, { status: string; outputPreview: string; durationMs: number }>;
}

interface SquadExtensionState {
	members: SquadMemberConfig[];
	manager: SquadManager | null;
	dispatcher: BackgroundDispatcher | null;
	overlayHandle: OverlayHandle | null;
	state: SquadState;
	currentCtx: ExtensionContext | null;
}

const state: SquadExtensionState = {
	members: [],
	manager: null,
	dispatcher: null,
	overlayHandle: null,
	state: { lastResults: new Map() },
	currentCtx: null,
};

function reconstructSquadState(ctx: ExtensionContext): void {
	state.state = { lastResults: new Map() };
	try {
		const branch = ctx.sessionManager.getBranch();
		for (const entry of branch) {
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (msg.role !== "toolResult" || msg.toolName !== "squad") continue;
			const details = msg.details as SquadToolDetails | undefined;
			if (!details?.results) continue;
			for (const result of details.results) {
				state.state.lastResults.set(result.role, {
					status: result.status,
					outputPreview: result.outputPreview ?? "",
					durationMs: result.durationMs,
				});
			}
		}
	} catch {}
}

function formatStatus(status: MemberStatus): string {
	const map: Record<MemberStatus, string> = {
		idle: "⚪ idle",
		spawning: "🟡 spawning",
		running: "🔵 running",
		completed: "🟢 completed",
		error: "🔴 error",
		aborted: "🟠 aborted",
		timeout: "🔴 timeout",
	};
	return map[status] || status;
}

function formatSize(chars: number): string {
	if (chars < 1000) return `${chars} chars`;
	if (chars < 1_000_000) return `${(chars / 1000).toFixed(1)}k chars`;
	return `${(chars / 1_000_000).toFixed(1)}M chars`;
}

function updateSquadStatus(ctx: any, manager: SquadManager): void {
	if (!ctx.hasUI) return;
	const members = manager.getMembers();
	if (members.size === 0) {
		ctx.ui.setStatus("squad", undefined);
		return;
	}

	const theme = ctx.ui.theme;
	const running = Array.from(members.values()).filter((m) => m.status === "running" || m.status === "spawning").length;
	const completed = Array.from(members.values()).filter((m) => m.status === "completed").length;
	const failed = Array.from(members.values()).filter((m) => m.status === "error" || m.status === "timeout").length;

	if (running > 0) ctx.ui.setStatus("squad", theme.fg("accent", "●") + theme.fg("dim", ` Squad: ${running} running`));
	else if (failed > 0)
		ctx.ui.setStatus("squad", theme.fg("error", "✗") + theme.fg("dim", ` Squad: ${completed}✓ ${failed}✗`));
	else if (completed > 0)
		ctx.ui.setStatus("squad", theme.fg("success", "✓") + theme.fg("dim", ` Squad: ${completed} done`));
	else ctx.ui.setStatus("squad", theme.fg("dim", `Squad: ${members.size} ready`));
}

export default function SquadExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		state.currentCtx = ctx;
		state.members = discoverSquadMembers(ctx.cwd);
		const warnings = validateAllSquadMembers(state.members);
		for (const warning of warnings) ctx.ui.notify(warning, "warning");

		state.manager = new SquadManager(ctx.cwd, {
			onStatusChange: (role, status) => {
				ctx.ui.setStatus(`squad-${role}`, `[${role}] ${formatStatus(status)}`);
				updateSquadStatus(ctx, state.manager!);
				if (status === "error" || status === "timeout") {
					const member = state.manager?.getMember(role);
					ctx.ui.notify(`✗ ${member?.config.name ?? role} ${status}: ${member?.error ?? ""}`, "error");
				} else if (status === "completed") {
					const member = state.manager?.getMember(role);
					if (member) ctx.ui.notify(`✓ ${member.config.name} completed (${formatSize(member.output.length)})`, "info");
				}
				if (state.manager?.isAllDone()) {
					const members = state.manager.getMembers();
					const completedCount = Array.from(members.values()).filter((m) => m.status === "completed").length;
					const failedCount = Array.from(members.values()).filter(
						(m) => m.status !== "completed" && m.status !== "idle",
					).length;
					if (completedCount + failedCount > 0)
						ctx.ui.notify(
							`All squad members done: ${completedCount} completed, ${failedCount} failed`,
							failedCount > 0 ? "warning" : "info",
						);
				}
			},
			onOutput: () => {
				updateSquadStatus(ctx, state.manager!);
			},
		});

		state.dispatcher = new BackgroundDispatcher(state.manager, ctx, pi);
		state.manager.loadMembers(state.members);

		reconstructSquadState(ctx);

		if (state.members.length > 0) {
			for (const member of state.members) ctx.ui.setStatus(`squad-${member.role}`, `[${member.role}] idle`);
			updateSquadStatus(ctx, state.manager);
		}

		state.manager.cleanupOldSessions();
	});

	pi.on("session_switch", async (_event, ctx) => {
		state.currentCtx = ctx;
		state.manager?.destroyAll();
		state.members = discoverSquadMembers(ctx.cwd);
		state.manager?.loadMembers(state.members);
		reconstructSquadState(ctx);
		updateSquadStatus(ctx, state.manager!);
	});

	pi.on("session_fork", async (_event, ctx) => {
		state.currentCtx = ctx;
		reconstructSquadState(ctx);
	});
	pi.on("session_tree", async (_event, ctx) => {
		state.currentCtx = ctx;
		reconstructSquadState(ctx);
	});
	pi.on("session_shutdown", async () => {
		await state.manager?.gracefulShutdown();
		state.dispatcher?.stopPolling();
		state.manager = null;
		state.dispatcher = null;
		state.currentCtx = null;
	});
	pi.on("before_agent_start", async (_event, _ctx) => {
		const members = state.manager?.getMembers();
		if (!members || members.size === 0) return;

		const memberCatalog = Array.from(members.values())
			.map(
				(m) =>
					`### ${m.config.name} (${m.config.role})\n${m.config.description || "No description"}\n**Tools:** ${m.config.tools || "all"}`,
			)
			.join("\n\n");

		// Check if there are recent results to inject
		const hasRecentResults = state.state.lastResults.size > 0;
		const resultSummary = hasRecentResults
			? Array.from(state.state.lastResults.entries())
					.map(([role, r]) => `  - ${role}: ${r.status} (${(r.durationMs / 1000).toFixed(1)}s)`)
					.join("\n")
			: "";

		return {
			systemPrompt: `You are a coordinator for squad members (specialist background agents).

## Available Squad Members
${memberCatalog}

## How to Work
- Use the \`squad\` tool to delegate tasks to squad members
- For parallel work, use \`broadcast\` (same prompt to all) or \`parallel_dispatch\` (different prompts)
- These actions are **NON-BLOCKING** - they return immediately with a task ID
- **After dispatching, CONTINUE the conversation with the user - do NOT wait or poll**
- **When you see "✅ Squad Task Complete" notification, IMMEDIATELY call get_completed_outputs**
- The notification will wake you up automatically - retrieve outputs right away

## Critical Rules
1. **FIRE AND FORGET**: After calling \`broadcast\` or \`parallel_dispatch\`, immediately continue helping the user
2. **DO NOT POLL**: Never call \`get_status\` repeatedly - wait for the automatic completion notification
3. **AUTO-RETRIEVE**: When you see "✅ Squad Task Complete", immediately call \`get_completed_outputs\` with the task_id
4. **ONE CALL PER TASK**: Use the task ID from the dispatch response to retrieve outputs

## Workflow Example
\`\`\`
User: "Research our auth system"

You: { action: "parallel_dispatch", prompts: {...} }
→ Returns: Task ID: squad_abc123

You: "I've dispatched the research. While waiting, what else can I help with?"
[You continue conversation...]

[30s later - automatic notification appears AND WAKES YOU UP]
✅ Squad Task Complete (28.4s)
Task ID: squad_abc123

You: [AUTOMATICALLY retrieve outputs]
{ action: "get_completed_outputs", task_id: "squad_abc123" }
→ Gets all outputs, presents results
\`\`\`

## Recent Results (if any)
${hasRecentResults ? resultSummary : "No recent results"}
`,
		};
	});

	pi.registerTool({
		name: "squad",
		label: "Squad",
		description:
			"Dispatch tasks to squad members (background agents). broadcast/parallel_dispatch are NON-BLOCKING - continue conversation after dispatch, wait for auto-notification.",
		promptSnippet: "Dispatch tasks to specialized background squad agents",
		promptGuidelines: [
			"Use squad tool to dispatch tasks to specialized squad members.",
			"Actions: list_members, broadcast (NON-BLOCKING), parallel_dispatch (NON-BLOCKING), dispatch_to, get_status, get_completed_outputs, cancel, get_output.",
			"CRITICAL: After broadcast/parallel_dispatch, CONTINUE conversation - DO NOT wait or poll.",
			"You will be AUTOMATICALLY NOTIFIED when tasks complete - no need to check status.",
			"When notified, use get_completed_outputs with task_id to retrieve all outputs.",
			"Squad members run in background without main session context.",
			"Provide clear, self-contained prompts.",
		],
		parameters: Type.Object({
			action: StringEnum([
				"list_members",
				"broadcast",
				"parallel_dispatch",
				"dispatch_to",
				"get_status",
				"get_completed_outputs",
				"cancel",
				"get_output",
			] as const),
			prompt: Type.Optional(Type.String({ description: "Task prompt" })),
			role: Type.Optional(Type.String({ description: "Squad member role" })),
			prompts: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Map of role to prompt" })),
			task_id: Type.Optional(Type.String({ description: "Task ID from broadcast/parallel_dispatch" })),
		}),
		async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
			if (!state.manager) throw new Error("Squad manager not initialized");
			const { action, prompt, role } = params;
			// Use placeholder session IDs for now - notification system can be enhanced later
			const parentSessionID = `session_${Date.now()}`;
			const parentMessageID = `msg_${Date.now()}`;

			switch (action) {
				case "list_members": {
					const members = state.manager.getMembers();
					if (members.size === 0)
						return {
							content: [{ type: "text", text: "No squad members found." }],
							details: { action: "list_members", members: [] } satisfies SquadToolDetails,
						};
					const lines = ["Available squad members:"];
					for (const [role, member] of members) {
						lines.push(
							`  • ${member.config.name} (${role}) — ${member.config.description || "no description"} [${member.config.scope}]`,
						);
						if (member.config.model) lines.push(`    model: ${member.config.model}`);
						if (member.config.tools) lines.push(`    tools: ${member.config.tools}`);
					}
					return {
						content: [{ type: "text", text: lines.join("\n") }],
						details: { action: "list_members", members: Array.from(members.keys()) } satisfies SquadToolDetails,
					};
				}
				case "broadcast": {
					if (!prompt) throw new Error("Missing required parameter: prompt");
					const roles = state.manager.getRoles();
					if (roles.length === 0)
						return {
							content: [{ type: "text", text: "No squad members configured." }],
							details: { action: "broadcast", dispatched: [] } satisfies SquadToolDetails,
						};
					const taskId = state.dispatcher!.dispatchAllBackground(prompt, parentSessionID, parentMessageID);
					return {
						content: [
							{
								type: "text",
								text: `✅ Squad broadcast launched (NON-BLOCKING)\n\nTask ID: \`${taskId}\`\nMembers: ${roles.join(", ")}\n\n**Continue the conversation** - you will be automatically notified when complete.`,
							},
						],
						details: { action: "broadcast", dispatching: roles, taskId } as SquadToolDetails & { taskId: string },
					};
				}
				case "parallel_dispatch": {
					if (!params.prompts) throw new Error("Missing required parameter: prompts");
					const prompts = params.prompts;
					const roles = Object.keys(prompts);
					if (roles.length === 0)
						return {
							content: [{ type: "text", text: "No prompts provided." }],
							details: { action: "parallel_dispatch", dispatched: [] } satisfies SquadToolDetails,
						};
					const members = state.manager.getMembers();
					const invalidRoles = roles.filter((r) => !members.has(r));
					if (invalidRoles.length > 0) throw new Error(`Unknown squad member(s): ${invalidRoles.join(", ")}`);
					const taskId = state.dispatcher!.dispatchCustomBackground(prompts, parentSessionID, parentMessageID);
					return {
						content: [
							{
								type: "text",
								text: `✅ Squad parallel dispatch launched (NON-BLOCKING)\n\nTask ID: \`${taskId}\`\nMembers: ${roles.join(", ")}\n\n**Continue the conversation** - you will be automatically notified when complete.`,
							},
						],
						details: { action: "parallel_dispatch", dispatching: roles, taskId } as SquadToolDetails & { taskId: string },
					};
				}
				case "dispatch_to": {
					if (!prompt) throw new Error("Missing required parameter: prompt");
					if (!role) throw new Error("Missing required parameter: role");
					const member = state.manager.getMember(role);
					if (!member) throw new Error(`Unknown squad member: ${role}`);

					// Reset state for new background dispatch
					member.output = "";
					member.error = undefined;
					member.lastPrompt = prompt;
					member.startedAt = Date.now();
					// Status will be set to "spawning" by dispatchOne, then "running"/"completed"

					// Use BackgroundDispatcher for proper notification when complete
					const parentSessionID = `session_${Date.now()}`;
					const parentMessageID = `msg_${Date.now()}`;
					const taskId = state.dispatcher!.dispatchOneBackground(role, prompt, parentSessionID, parentMessageID);

					// Return immediately - member is running in background
					return {
						content: [
							{
								type: "text",
								text: `▶ Dispatched to ${member.config.name} (${role}) — running in background`,
							},
						],
						details: {
							action: "dispatch_to",
							role,
							status: "running",
						} satisfies SquadToolDetails,
					};
				}
				case "get_status": {
					const members = state.manager.getMembers();
					const lines = ["Squad status:"];
					for (const [role, member] of members) {
						const statusIconMap: Record<MemberStatus, string> = {
							idle: "○",
							spawning: "◐",
							running: "●",
							completed: "✓",
							error: "✗",
							aborted: "⊘",
							timeout: "⏱",
						};
						const statusIcon = statusIconMap[member.status] || "?";
						let line = `  ${statusIcon} ${member.config.name} (${role}): ${member.status}`;
						if (member.startedAt && (member.status === "running" || member.status === "spawning"))
							line += ` (${((Date.now() - member.startedAt) / 1000).toFixed(1)}s elapsed)`;
						if (member.status === "completed" && member.output) line += ` — ${member.output.length} chars output`;
						if (member.error) line += ` — ${member.error}`;
						lines.push(line);
					}
					return {
						content: [{ type: "text", text: lines.join("\n") }],
						details: {
							action: "get_status",
							memberStatuses: Array.from(members.entries()).map(([role, m]) => ({ role, status: m.status })),
						} satisfies SquadToolDetails,
					};
				}
				case "get_completed_outputs": {
					if (!params.task_id) throw new Error("Missing required parameter: task_id");
					const task = state.dispatcher!.getTask(params.task_id);
					if (!task)
						return {
							content: [{ type: "text", text: `Task ${params.task_id} not found. Use get_status to check active tasks.` }],
							details: { action: "get_completed_outputs" } satisfies SquadToolDetails,
						};
					if (task.status !== "completed")
						return {
							content: [
								{ type: "text", text: `Task ${params.task_id} is still ${task.status}. Wait for completion notification.` },
							],
							details: { action: "get_completed_outputs" } satisfies SquadToolDetails,
						};

					const results = Array.from(task.results.values());
					const lines = [`**Task ${params.task_id} - Full Outputs**\n`];
					for (const result of results) {
						lines.push(`\n### ${result.role} (${(result.durationMs / 1000).toFixed(1)}s)\n`);
						if (result.error) {
							lines.push(`**Error:** ${result.error}\n`);
						} else if (result.output) {
							lines.push(result.output);
						} else {
							lines.push("*No output*");
						}
						lines.push("\n---\n");
					}
					return {
						content: [{ type: "text", text: lines.join("\n") }],
						details: { action: "get_completed_outputs", taskId: params.task_id } satisfies SquadToolDetails,
					};
				}
				case "get_output": {
					if (!role) throw new Error("Missing required parameter: role");
					const member = state.manager.getMember(role);
					if (!member) throw new Error(`Unknown squad member: ${role}`);
					if (member.status === "running" || member.status === "spawning")
						return {
							content: [{ type: "text", text: `${role} is still ${member.status}.` }],
							details: { action: "get_output", role, status: member.status } satisfies SquadToolDetails,
						};
					const maxLen = 20000;
					const output =
						member.output.length > maxLen
							? `${member.output.slice(0, maxLen)}\n... [truncated, ${member.output.length - maxLen} chars omitted]`
							: member.output;
					return {
						content: [{ type: "text", text: output || `No output from ${role}.` }],
						details: {
							action: "get_output",
							role,
							status: member.status,
							outputLength: member.output.length,
						} satisfies SquadToolDetails,
					};
				}
				case "cancel": {
					if (role) {
						state.manager.abort(role);
						return {
							content: [{ type: "text", text: `Cancelled: ${role}` }],
							details: { action: "cancel", role } satisfies SquadToolDetails,
						};
					}
					state.manager.abortAll();
					return {
						content: [{ type: "text", text: "Cancelled all squad members." }],
						details: { action: "cancel", all: true } satisfies SquadToolDetails,
					};
				}
				default:
					throw new Error(`Unknown action: ${action}`);
			}
		},
		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("squad ")) + theme.fg("accent", args.action);
			if (args.role) text += ` ${theme.fg("muted", args.role)}`;
			if (args.prompt) {
				const preview = args.prompt.length > 80 ? `${args.prompt.slice(0, 77)}...` : args.prompt;
				text += `\n${theme.fg("dim", `  "${preview}"`)}`;
			}
			return new Text(text, 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as any;
			if (isPartial) {
				const content = result.content[0];
				if (content?.type === "text") return new Text(theme.fg("accent", "● ") + theme.fg("dim", content.text), 0, 0);
				return new Text(theme.fg("accent", "● Squad dispatching..."), 0, 0);
			}
			if (details?.action === "list_members") {
				const count = details.members?.length ?? 0;
				let text = theme.fg("success", `${count} squad member(s)`);
				if (expanded && result.content[0]?.type === "text") text += `\n${theme.fg("dim", result.content[0].text)}`;
				return new Text(text, 0, 0);
			}
			if (details?.action === "get_status") {
				const memberStatuses = details.memberStatuses as Array<{ role: string; status: string }> | undefined;
				if (!memberStatuses) return new Text(theme.fg("dim", "No status data"), 0, 0);
				const running = memberStatuses.filter((m) => m.status === "running").length;
				const completed = memberStatuses.filter((m) => m.status === "completed").length;
				const failed = memberStatuses.filter((m) => m.status === "error" || m.status === "timeout").length;
				let text = "";
				if (running > 0) text += theme.fg("accent", `${running} running `);
				if (completed > 0) text += theme.fg("success", `${completed} done `);
				if (failed > 0) text += theme.fg("error", `${failed} failed `);
				if (expanded && result.content[0]?.type === "text") text += `\n${theme.fg("dim", result.content[0].text)}`;
				return new Text(text, 0, 0);
			}
			if (details?.action === "get_completed_outputs") {
				let text = theme.fg("success", "✓ Task outputs retrieved");
				if (expanded && result.content[0]?.type === "text")
					text += `\n${theme.fg("dim", result.content[0].text.slice(0, 500))}`;
				return new Text(text, 0, 0);
			}
			if (
				details?.action === "broadcast" ||
				details?.action === "parallel_dispatch" ||
				details?.action === "dispatch_to"
			) {
				const results = details.results as
					| Array<{ role: string; status: string; durationMs: number; outputLength?: number }>
					| undefined;
				if (results) {
					const completedCount = results.filter((r) => r.status === "completed").length;
					const icon = completedCount === results.length ? theme.fg("success", "✓") : theme.fg("warning", "⚠");
					let text = `${icon} ${completedCount}/${results.length} members completed`;
					if (expanded) {
						for (const r of results) {
							const statusIcon = r.status === "completed" ? "✓" : "✗";
							text += `\n  ${statusIcon} ${r.role} (${(r.durationMs / 1000).toFixed(1)}s)`;
							if (r.outputLength) text += theme.fg("dim", ` — ${formatSize(r.outputLength)}`);
						}
					}
					return new Text(text, 0, 0);
				}
				if (details?.role) {
					// Handle different status icons: running/spawning → ●, completed → ✓, others → ✗
					let statusIcon: string;
					let statusColor: "success" | "error" | "accent";
					if (details.status === "completed") {
						statusIcon = "✓";
						statusColor = "success";
					} else if (details.status === "running" || details.status === "spawning") {
						statusIcon = "●";
						statusColor = "accent";
					} else {
						statusIcon = "✗";
						statusColor = "error";
					}
					const duration = details.durationMs ? `${(details.durationMs / 1000).toFixed(1)}s` : "";
					let text = theme.fg(statusColor, `${statusIcon} ${details.role} ${duration}`);
					if (expanded && result.content[0]?.type === "text") {
						const lines = result.content[0].text.split("\n");
						text += `\n${theme.fg("dim", lines.slice(0, 20).join("\n"))}`;
						if (lines.length > 20) text += `\n${theme.fg("muted", `... ${lines.length - 20} more lines`)}`;
					}
					return new Text(text, 0, 0);
				}
			}
			if (details?.action === "cancel") return new Text(theme.fg("warning", "⊘ Cancelled"), 0, 0);
			const content = result.content[0];
			if (content?.type === "text") {
				const preview = content.text.split("\n")[0] || "";
				let text = preview.length > 100 ? `${preview.slice(0, 97)}...` : preview;
				if (expanded) text = content.text;
				return new Text(text, 0, 0);
			}
			return new Text(theme.fg("dim", "No output"), 0, 0);
		},
	});

	pi.registerCommand("squad", {
		description: "Open squad dashboard, or subcommands: list, status, reload, dispatch, abort, result",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const subcommands = ["list", "status", "reload", "dispatch", "abort", "result"];
			const filtered = subcommands.filter((s) => s.startsWith(prefix));
			return filtered.length > 0 ? filtered.map((s) => ({ value: s, label: s })) : null;
		},
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Squad UI requires interactive mode", "warning");
				return;
			}
			if (!state.manager) {
				ctx.ui.notify("Squad manager not initialized", "error");
				return;
			}
			const [subcommand, ...rest] = (args ?? "").trim().split(/\s+/);
			if (!subcommand || subcommand === "" || subcommand === "open") {
				const callbacks: SquadOverlayCallbacks = {
					onSnapshot: (snapshotText) => {
						state.overlayHandle?.setHidden(true);
						pi.sendMessage({ customType: "squad_snapshot", content: snapshotText, display: true }, { triggerTurn: true });
					},
					onDispatch: (role, prompt) => {
						if (role === "all") state.manager?.dispatchAll(prompt);
						else state.manager?.dispatchOne(role, prompt);
					},
					onAbort: (role) => {
						if (role === "all") state.manager?.abortAll();
						else state.manager?.abort(role);
					},
				};
				await ctx.ui.custom<string | undefined>(
					(tui, theme, _keybindings, done) => new SquadOverlay(tui, theme, state.manager!, done, callbacks),
					{
						overlay: true,
						onHandle: (handle) => {
							state.overlayHandle = handle;
						},
					},
				);
				state.overlayHandle = null;
				return;
			}
			const restArgs = rest.join(" ");
			switch (subcommand) {
				case "list": {
					const members = state.manager.getMembers();
					if (members.size === 0) {
						ctx.ui.notify("No squad members found.", "warning");
						return;
					}
					await ctx.ui.select(
						"Squad Members",
						Array.from(members.values()).map(
							(m) => `${m.config.name} (${m.config.role}) — ${m.config.description || "no description"} [${m.config.scope}]`,
						),
					);
					return;
				}
				case "status": {
					const members = state.manager.getMembers();
					const items = Array.from(members.values()).map((m) => {
						let line = `${m.config.name} (${m.config.role}): ${m.status}`;
						if (m.startedAt && m.status === "running") line += ` (${((Date.now() - m.startedAt) / 1000).toFixed(1)}s)`;
						return line;
					});
					if (items.length === 0) {
						ctx.ui.notify("No squad members loaded.", "info");
						return;
					}
					await ctx.ui.select("Squad Status", items);
					return;
				}
				case "reload": {
					const members = discoverSquadMembers(ctx.cwd);
					state.manager.loadMembers(members);
					for (const member of members) {
						for (const w of validateSquadMember(member)) ctx.ui.notify(w, "warning");
					}
					ctx.ui.notify(`Reloaded squad: ${members.length} member(s) found.`, "info");
					updateSquadStatus(ctx, state.manager);
					return;
				}
				case "dispatch": {
					if (!restArgs) {
						ctx.ui.notify("Usage: /squad dispatch <prompt>", "warning");
						return;
					}
					ctx.ui.notify(`Dispatching to ${state.manager.getRoles().length} squad members...`, "info");
					state.manager.dispatchAll(restArgs).then((results) => {
						const completed = results.filter((r) => r.status === "completed").length;
						const failed = results.filter((r) => r.status !== "completed").length;
						ctx.ui.notify(
							`Squad dispatch done: ${completed} completed, ${failed} failed/timed out.`,
							failed > 0 ? "warning" : "info",
						);
					});
					return;
				}
				case "abort": {
					if (restArgs) {
						state.manager.abort(restArgs);
						ctx.ui.notify(`Aborted: ${restArgs}`, "info");
					} else {
						state.manager.abortAll();
						ctx.ui.notify("Aborted all squad members.", "info");
					}
					updateSquadStatus(ctx, state.manager);
					return;
				}
				case "result": {
					if (!restArgs) {
						ctx.ui.notify("Usage: /squad result <role>", "warning");
						return;
					}
					const member = state.manager.getMember(restArgs);
					if (!member) {
						ctx.ui.notify(`Unknown member: ${restArgs}`, "error");
						return;
					}
					if (!member.output) {
						ctx.ui.notify(`No output from ${restArgs} yet.`, "info");
						return;
					}
					await ctx.ui.editor(`${member.config.name} Output`, member.output);
					return;
				}
				default:
					ctx.ui.notify(
						`Unknown subcommand: ${subcommand}. Available: list, status, reload, dispatch, abort, result`,
						"warning",
					);
			}
		},
	});

	pi.registerShortcut("ctrl+shift+s", {
		description: "Open squad dashboard",
		handler: async (ctx) => {
			if (!ctx.hasUI) return;
			if (!state.manager) {
				ctx.ui.notify("Squad manager not initialized", "error");
				return;
			}
			const callbacks: SquadOverlayCallbacks = {
				onSnapshot: (snapshotText) => {
					state.overlayHandle?.setHidden(true);
					pi.sendMessage({ customType: "squad_snapshot", content: snapshotText, display: true }, { triggerTurn: true });
				},
				onDispatch: (role, prompt) => {
					if (role === "all") state.manager?.dispatchAll(prompt);
					else state.manager?.dispatchOne(role, prompt);
				},
				onAbort: (role) => {
					if (role === "all") state.manager?.abortAll();
					else state.manager?.abort(role);
				},
			};
			await ctx.ui.custom<string | undefined>(
				(tui, theme, _keybindings, done) => new SquadOverlay(tui, theme, state.manager!, done, callbacks),
				{
					overlay: true,
					onHandle: (handle) => {
						state.overlayHandle = handle;
					},
				},
			);
			state.overlayHandle = null;
		},
	});

	pi.registerMessageRenderer("squad_snapshot", (message, _options, theme) => {
		const { Box, Text } = require("@mariozechner/pi-tui") as typeof import("@mariozechner/pi-tui");
		const { truncateToWidth } = require("@mariozechner/pi-tui") as typeof import("@mariozechner/pi-tui");
		const header = theme.fg("accent", "[Squad Snapshot]");
		const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
		const lines = [header, ""];
		const content =
			typeof message.content === "string"
				? message.content
				: message.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
		for (const line of content.split("\n")) lines.push(truncateToWidth(line, 80));
		box.addChild(new Text(lines.join("\n"), 0, 0));
		return box;
	});
	pi.registerMessageRenderer("squad-context", () => undefined);
	pi.registerMessageRenderer("squad-task-complete", (message, { expanded }, theme) => {
		if (!expanded) {
			return new Text(theme.fg("success", "✅ Squad task complete - use get_completed_outputs to retrieve"), 0, 0);
		}
		return new Text(message.content as string, 0, 0);
	});
}
