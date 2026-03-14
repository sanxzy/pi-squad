/**
 * Squad Extension - Interactive Overlay UI
 *
 * Implements a full-screen interactive overlay for managing squad members,
 * viewing live output, and sending prompts. Follows the Component + Focusable
 * pattern from pi-messenger's extension UI system.
 */

import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component, Focusable, TUI } from "@mariozechner/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { MemberStatus, SquadManager } from "./manager";
import { createSquadViewState, type SquadViewState, setNotification } from "./overlay-actions";
import {
	renderMemberChat,
	renderMemberDetail,
	renderMemberList,
	renderMemberOutput,
	renderOverlayLegend,
	renderOverlayStatusBar,
	renderSessionsGrid,
} from "./overlay-render";

/** Status icons for each member status. */
const STATUS_ICONS: Record<MemberStatus, string> = {
	idle: "○",
	spawning: "◐",
	running: "●",
	completed: "✓",
	error: "✗",
	aborted: "⊘",
	timeout: "⏱",
};

/**
 * Callbacks for overlay actions.
 */
export interface SquadOverlayCallbacks {
	/** Called when user presses Ctrl+T to send a snapshot to the chat */
	onSnapshot?: (snapshot: string) => void;
	/** Called when user dispatches a prompt from the overlay */
	onDispatch?: (role: string | "all", prompt: string) => void;
	/** Called when user aborts a member from the overlay */
	onAbort?: (role: string | "all") => void;
	/** Called when user sends a chat message from the overlay */
	onMessage?: (role: string, message: string) => void;
}

/**
 * Squad overlay component implementing Component and Focusable interfaces.
 */
export class SquadOverlay implements Component, Focusable {
	focused = false;

	private viewState: SquadViewState;
	private refreshTimer: ReturnType<typeof setInterval> | undefined;

	constructor(
		private tui: TUI,
		private theme: Theme,
		private manager: SquadManager,
		private cwd: string,
		private done: (snapshot?: string) => void,
		private callbacks: SquadOverlayCallbacks,
	) {
		this.viewState = createSquadViewState();

		// Refresh every 1s for elapsed time and progress updates
		this.refreshTimer = setInterval(() => {
			this.tui.requestRender();
		}, 1000);
	}

	/** Dynamic width based on terminal */
	get width(): number {
		return Math.min(100, Math.max(40, process.stdout.columns ?? 90));
	}

	// ── Component Interface ──────────────────────────────────

	render(_width: number): string[] {
		const w = this.width;
		const innerW = w - 2;
		const sectionW = innerW - 2;
		const border = (s: string) => this.theme.fg("dim", s);

		const row = (content: string) => {
			const safe = truncateToWidth(content, sectionW);
			const pad = " ".repeat(Math.max(0, innerW - visibleWidth(safe) - 1));
			return `${border("│")} ${safe}${pad}${border("│")}`;
		};
		const _emptyRow = () => border("│") + " ".repeat(innerW) + border("│");

		const lines: string[] = [];

		// ── Title Bar ──
		const titleText = " ◆ Squad ◆ ";
		const titleLen = visibleWidth(titleText);
		const borderLen = Math.max(0, innerW - titleLen);
		const leftBorder = Math.floor(borderLen / 2);
		const rightBorder = borderLen - leftBorder;
		lines.push(
			border("╭") +
				this.theme.fg("accent", "━".repeat(leftBorder)) +
				this.theme.fg("accent", titleText) +
				this.theme.fg("accent", "━".repeat(rightBorder)) +
				border("╮"),
		);

		// ── Status Bar ──
		lines.push(row(renderOverlayStatusBar(this.theme, this.manager, sectionW)));

		// ── Notification Bar ──
		const notif = this.viewState.notification;
		const hasNotif = notif && Date.now() < notif.expiresAt;
		if (hasNotif) {
			lines.push(row(this.theme.fg("accent", notif.message)));
		}

		// ── Separator ──
		lines.push(border("├") + this.theme.fg("dim", "┄".repeat(innerW)) + border("┤"));

		// ── Content ──
		const chromeLines = hasNotif ? 8 : 7; // title + status + [notif] + sep + empty + separator + legend + bottom
		const termRows = process.stdout.rows ?? 24;
		const contentHeight = Math.max(8, termRows - chromeLines);

		const members = Array.from(this.manager.getMembers().values());
		const selectedMember = members[this.viewState.selectedIndex] ?? null;

		let contentLines: string[];

		if (this.viewState.mode === "sessions") {
			// Grid of all member session panels
			contentLines = renderSessionsGrid(this.theme, this.manager, sectionW, contentHeight, this.viewState);
		} else if (this.viewState.mode === "output" && selectedMember) {
			// Full output view for a member
			contentLines = renderMemberOutput(this.theme, selectedMember, sectionW, contentHeight, this.viewState);
		} else if (this.viewState.mode === "chat" && selectedMember) {
			// Chat view for a member
			contentLines = renderMemberChat(this.theme, selectedMember, this.cwd, sectionW, contentHeight, this.viewState);
		} else if (this.viewState.mode === "detail" && selectedMember) {
			// Detail view: config, progress, partial output
			contentLines = renderMemberDetail(this.theme, selectedMember, sectionW, contentHeight, this.viewState);
		} else {
			// List view: all members
			contentLines = renderMemberList(this.theme, this.manager, sectionW, contentHeight, this.viewState);
		}

		for (const line of contentLines) {
			lines.push(row(line));
		}

		// ── Footer ──
		lines.push(border(`├${"─".repeat(innerW)}┤`));
		lines.push(row(renderOverlayLegend(this.theme, this.viewState, selectedMember, sectionW)));
		lines.push(border(`╰${"─".repeat(innerW)}╯`));

		return lines;
	}

	handleInput(data: string): void {
		// ── Ctrl+T: send snapshot to chat ──
		if (data === "\x14") {
			this.done(this.generateSnapshot());
			return;
		}

		// ── Confirmation mode ──
		if (this.viewState.confirmAction) {
			this.handleConfirmInput(data);
			return;
		}

		// ── Chat input mode ──
		if (this.viewState.chatInputFocused) {
			this.handleChatInput(data);
			return;
		}

		// ── Prompt input mode ──
		if (this.viewState.inputMode === "prompt") {
			this.handlePromptInput(data);
			return;
		}

		// ── Normal mode ──

		// Escape: exit detail/output → list, or close overlay
		if (matchesKey(data, "escape")) {
			if (this.viewState.mode !== "list") {
				this.viewState.mode = "list";
				this.tui.requestRender();
			} else {
				this.done();
			}
			return;
		}

		const members = Array.from(this.manager.getMembers().values());

		// ── Sessions mode navigation ──
		if (this.viewState.mode === "sessions") {
			if (matchesKey(data, "left")) {
				this.viewState.sessionsFocusIndex = Math.max(0, this.viewState.sessionsFocusIndex - 1);
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, "right")) {
				this.viewState.sessionsFocusIndex = Math.min(members.length - 1, this.viewState.sessionsFocusIndex + 1);
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, "up")) {
				// Move up one row in the grid (cols = grid column count)
				const cols =
					members.length <= 2 ? members.length : members.length <= 4 ? 2 : Math.min(3, Math.ceil(Math.sqrt(members.length)));
				const newIdx = this.viewState.sessionsFocusIndex - cols;
				if (newIdx >= 0) this.viewState.sessionsFocusIndex = newIdx;
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, "down")) {
				const cols =
					members.length <= 2 ? members.length : members.length <= 4 ? 2 : Math.min(3, Math.ceil(Math.sqrt(members.length)));
				const newIdx = this.viewState.sessionsFocusIndex + cols;
				if (newIdx < members.length) this.viewState.sessionsFocusIndex = newIdx;
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, "enter") && members.length > 0) {
				this.viewState.selectedIndex = this.viewState.sessionsFocusIndex;
				this.viewState.mode = "output";
				this.viewState.detailScroll = 0;
				this.viewState.detailAutoScroll = true;
				this.tui.requestRender();
				return;
			}
			// Fall through for p, shift+p, a, shift+a, r keys in sessions mode
		}

		// ── Navigation (list/detail/output) ──
		// Left/right for tab navigation in list mode
		if (this.viewState.mode === "list") {
			if (matchesKey(data, "left")) {
				this.viewState.selectedIndex = Math.max(0, this.viewState.selectedIndex - 1);
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, "right")) {
				this.viewState.selectedIndex = Math.min(members.length - 1, this.viewState.selectedIndex + 1);
				this.tui.requestRender();
				return;
			}
		}

		// Up/down for scrolling in detail/output modes
		if (this.viewState.mode === "detail" || this.viewState.mode === "output") {
			if (matchesKey(data, "up")) {
				this.viewState.detailScroll = Math.max(0, this.viewState.detailScroll - 1);
				this.viewState.detailAutoScroll = false;
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, "down")) {
				this.viewState.detailScroll++;
				this.tui.requestRender();
				return;
			}
		}

		// Home/end for quick navigation
		if (matchesKey(data, "home")) {
			this.viewState.selectedIndex = 0;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "end")) {
			this.viewState.selectedIndex = Math.max(0, members.length - 1);
			this.tui.requestRender();
			return;
		}

		// Tab: cycle through members in list mode
		if (matchesKey(data, "tab") && this.viewState.mode === "list" && members.length > 0) {
			this.viewState.selectedIndex = (this.viewState.selectedIndex + 1) % members.length;
			this.tui.requestRender();
			return;
		}

		// Enter: toggle detail view for selected member
		if (matchesKey(data, "enter")) {
			if (this.viewState.mode === "list" && members.length > 0) {
				this.viewState.mode = "detail";
				this.viewState.detailScroll = 0;
			} else if (this.viewState.mode === "detail") {
				this.viewState.mode = "list";
			}
			this.tui.requestRender();
			return;
		}

		// s: enter sessions grid view
		if (matchesKey(data, "s") && this.viewState.mode === "list" && members.length > 0) {
			this.viewState.mode = "sessions";
			this.viewState.sessionsFocusIndex = this.viewState.selectedIndex;
			this.tui.requestRender();
			return;
		}

		// o: open full output view
		if (matchesKey(data, "o") && members.length > 0) {
			this.viewState.mode = "output";
			this.viewState.detailScroll = 0;
			this.viewState.detailAutoScroll = true;
			this.tui.requestRender();
			return;
		}

		// c: open chat view for selected member
		if (matchesKey(data, "c") && members.length > 0) {
			this.viewState.mode = "chat";
			this.viewState.chatScroll = 0;
			this.viewState.chatAutoScroll = true;
			this.viewState.chatInputFocused = false;
			this.viewState.chatInput = "";
			this.tui.requestRender();
			return;
		}

		// ── Actions ──

		// p: enter prompt input mode (dispatch to selected or all)
		if (matchesKey(data, "p")) {
			this.viewState.inputMode = "prompt";
			this.viewState.promptInput = "";
			this.tui.requestRender();
			return;
		}

		// shift+p: prompt ALL members
		if (matchesKey(data, "shift+p")) {
			this.viewState.inputMode = "prompt";
			this.viewState.promptInput = "@all ";
			this.tui.requestRender();
			return;
		}

		// a: abort selected member (with confirm)
		if (matchesKey(data, "a") && members.length > 0) {
			const member = members[this.viewState.selectedIndex];
			if (member && (member.status === "running" || member.status === "spawning")) {
				this.viewState.confirmAction = {
					type: "abort",
					role: member.config.role,
					label: member.config.name,
				};
				this.tui.requestRender();
			}
			return;
		}

		// shift+a: abort ALL (with confirm)
		if (matchesKey(data, "shift+a")) {
			const running = members.filter((m) => m.status === "running" || m.status === "spawning");
			if (running.length > 0) {
				this.viewState.confirmAction = {
					type: "abort-all",
					label: `${running.length} running member(s)`,
				};
				this.tui.requestRender();
			}
			return;
		}

		// r: re-dispatch selected member (with confirm if running)
		if (matchesKey(data, "r") && members.length > 0) {
			const member = members[this.viewState.selectedIndex];
			if (member?.lastPrompt) {
				if (member.status === "running") {
					this.viewState.confirmAction = {
						type: "redispatch",
						role: member.config.role,
						label: member.config.name,
					};
				} else {
					this.callbacks.onDispatch?.(member.config.role, member.lastPrompt);
					setNotification(this.viewState, this.tui, true, `Re-dispatched ${member.config.name}`);
				}
				this.tui.requestRender();
			}
			return;
		}

		// scroll in detail/output mode
		if (this.viewState.mode === "detail" || this.viewState.mode === "output") {
			if (matchesKey(data, "left") || matchesKey(data, "[")) {
				this.viewState.detailScroll = Math.max(0, this.viewState.detailScroll - 1);
				this.viewState.detailAutoScroll = false;
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, "right") || matchesKey(data, "]")) {
				this.viewState.detailScroll++;
				this.tui.requestRender();
				return;
			}
		}

		// scroll in chat mode
		if (this.viewState.mode === "chat") {
			if (matchesKey(data, "up")) {
				this.viewState.chatScroll = Math.max(0, this.viewState.chatScroll - 1);
				this.viewState.chatAutoScroll = false;
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, "down")) {
				this.viewState.chatScroll++;
				this.viewState.chatAutoScroll = true;
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, "i")) {
				this.viewState.chatInputFocused = true;
				this.viewState.chatInput = "";
				this.tui.requestRender();
				return;
			}
		}
	}

	invalidate(): void {}

	dispose(): void {
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = undefined;
		}
		if (this.viewState.notificationTimer) {
			clearTimeout(this.viewState.notificationTimer);
		}
	}

	// ── Input Mode Handlers ──────────────────────────────────

	private handleConfirmInput(data: string): void {
		const action = this.viewState.confirmAction;
		if (!action) return;

		if (matchesKey(data, "y")) {
			switch (action.type) {
				case "abort":
					this.callbacks.onAbort?.(action.role!);
					setNotification(this.viewState, this.tui, true, `Aborted ${action.label}`);
					break;
				case "abort-all":
					this.callbacks.onAbort?.("all");
					setNotification(this.viewState, this.tui, true, "Aborted all members");
					break;
				case "redispatch": {
					const member = this.manager.getMember(action.role!);
					if (member?.lastPrompt) {
						this.callbacks.onDispatch?.(action.role!, member.lastPrompt);
						setNotification(this.viewState, this.tui, true, `Re-dispatched ${action.label}`);
					}
					break;
				}
				case "destroy":
					this.manager.destroy(action.role!);
					setNotification(this.viewState, this.tui, true, `Destroyed ${action.label}`);
					break;
				case "destroy-all":
					this.manager.destroyAll();
					setNotification(this.viewState, this.tui, true, "Destroyed all members");
					break;
			}
			this.viewState.confirmAction = null;
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "n") || matchesKey(data, "escape")) {
			this.viewState.confirmAction = null;
			this.tui.requestRender();
		}
	}

	private handlePromptInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.viewState.inputMode = "normal";
			this.viewState.promptInput = "";
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "enter")) {
			const raw = this.viewState.promptInput.trim();
			if (!raw) return;

			if (raw.startsWith("@all ")) {
				// Dispatch to all members
				const prompt = raw.slice(5).trim();
				if (prompt) {
					this.callbacks.onDispatch?.("all", prompt);
					setNotification(this.viewState, this.tui, true, "Dispatched to all members");
				}
			} else {
				// Dispatch to selected member
				const members = Array.from(this.manager.getMembers().values());
				const member = members[this.viewState.selectedIndex];
				if (member) {
					this.callbacks.onDispatch?.(member.config.role, raw);
					setNotification(this.viewState, this.tui, true, `Dispatched to ${member.config.name}`);
				}
			}

			this.viewState.inputMode = "normal";
			this.viewState.promptInput = "";
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "backspace")) {
			if (this.viewState.promptInput.length > 0) {
				this.viewState.promptInput = this.viewState.promptInput.slice(0, -1);
				this.tui.requestRender();
			}
			return;
		}

		// Printable characters
		if (data.length > 0 && data.charCodeAt(0) >= 32) {
			this.viewState.promptInput += data;
			this.tui.requestRender();
		}
	}

	private handleChatInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.viewState.chatInputFocused = false;
			this.viewState.chatInput = "";
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "enter")) {
			const raw = this.viewState.chatInput.trim();
			if (!raw) return;

			const members = Array.from(this.manager.getMembers().values());
			const member = members[this.viewState.selectedIndex];
			if (member) {
				this.callbacks.onMessage?.(member.config.role, raw);
				setNotification(this.viewState, this.tui, true, `Message sent to ${member.config.name}`);
			}

			this.viewState.chatInputFocused = false;
			this.viewState.chatInput = "";
			this.viewState.chatAutoScroll = true;
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "backspace")) {
			if (this.viewState.chatInput.length > 0) {
				this.viewState.chatInput = this.viewState.chatInput.slice(0, -1);
				this.tui.requestRender();
			}
			return;
		}

		// Printable characters
		if (data.length > 0 && data.charCodeAt(0) >= 32) {
			this.viewState.chatInput += data;
			this.tui.requestRender();
		}
	}

	// ── Snapshot Generation ──────────────────────────────────

	private generateSnapshot(): string {
		const members = this.manager.getMembers();
		const total = members.size;
		const running = Array.from(members.values()).filter((m) => m.status === "running" || m.status === "spawning").length;
		const completed = Array.from(members.values()).filter((m) => m.status === "completed").length;
		const failed = Array.from(members.values()).filter((m) => m.status === "error" || m.status === "timeout").length;

		const lines: string[] = [
			`Squad Status: ${total} members | ${running} running | ${completed} done | ${failed} failed`,
			"─".repeat(60),
		];

		for (const [role, member] of members) {
			const icon = STATUS_ICONS[member.status] || "?";
			let line = `${icon} ${member.config.name} (${role}): ${member.status}`;

			if (member.startedAt) {
				const endTime = Date.now();
				const elapsed = ((endTime - member.startedAt) / 1000).toFixed(1);
				line += ` [${elapsed}s]`;
			}

			if (member.output) {
				const outputSize = member.output.length;
				const sizeStr = outputSize < 1000 ? `${outputSize}c` : `${(outputSize / 1000).toFixed(1)}k`;
				line += ` (${sizeStr} output)`;
			}

			if (member.error) {
				line += ` — Error: ${member.error}`;
			}

			// Mini status bar for running members
			if (member.status === "running" && member.startedAt) {
				const elapsed = (Date.now() - member.startedAt) / 1000;
				const timeout = member.config.timeout / 1000;
				const pct = Math.min(100, (elapsed / timeout) * 100);
				const filled = Math.round(pct / 5);
				line += ` [${"█".repeat(filled)}${"░".repeat(20 - filled)}]`;
			}

			lines.push(line);
		}

		return lines.join("\n");
	}
}
