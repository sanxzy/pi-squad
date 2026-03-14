/**
 * Squad Extension - Overlay Actions & View State
 *
 * Manages the view state for the squad overlay UI, including
 * navigation, input modes, notifications, and confirmation dialogs.
 */

import type { TUI } from "@mariozechner/pi-tui";

/**
 * Current view mode for the overlay.
 */
export type SquadViewMode = "list" | "detail" | "output" | "sessions" | "chat";

/**
 * Input mode for the overlay.
 */
export type SquadInputMode = "normal" | "prompt" | "confirm";

/**
 * Pending confirmation action.
 */
export interface SquadConfirmAction {
	type: "abort" | "abort-all" | "destroy" | "destroy-all" | "redispatch";
	role?: string;
	label: string;
}

/**
 * View state for the squad overlay.
 */
export interface SquadViewState {
	/** Currently selected member index in the list */
	selectedIndex: number;

	/** Current view mode */
	mode: SquadViewMode;

	/** Scroll offset for member list */
	scrollOffset: number;

	/** Scroll offset for detail/output view */
	detailScroll: number;

	/** Auto-scroll to bottom in output view */
	detailAutoScroll: boolean;

	/** Current input mode */
	inputMode: SquadInputMode;

	/** Text being typed in prompt input mode */
	promptInput: string;

	/** Pending confirmation action */
	confirmAction: SquadConfirmAction | null;

	/** Transient notification */
	notification: { message: string; expiresAt: number } | null;

	/** Timer for auto-clearing notification */
	notificationTimer: ReturnType<typeof setTimeout> | null;

	/** Whether feed section is focused */
	feedFocus: boolean;

	/** Focused panel index in sessions grid view */
	sessionsFocusIndex: number;

	/** Scroll offset for chat view */
	chatScroll: number;

	/** Auto-scroll to bottom in chat view */
	chatAutoScroll: boolean;

	/** Chat message input text */
	chatInput: string;

	/** Whether chat input is focused */
	chatInputFocused: boolean;
}

/**
 * Create initial view state.
 */
export function createSquadViewState(): SquadViewState {
	return {
		selectedIndex: 0,
		mode: "list",
		scrollOffset: 0,
		detailScroll: 0,
		detailAutoScroll: true,
		inputMode: "normal",
		promptInput: "",
		confirmAction: null,
		notification: null,
		notificationTimer: null,
		feedFocus: false,
		sessionsFocusIndex: 0,
		chatScroll: 0,
		chatAutoScroll: true,
		chatInput: "",
		chatInputFocused: false,
	};
}

/**
 * Set a transient notification.
 *
 * @param viewState - Current view state
 * @param tui - TUI instance for requesting render
 * @param success - Whether the notification indicates success
 * @param message - Notification message
 */
export function setNotification(viewState: SquadViewState, tui: TUI, success: boolean, message: string): void {
	if (viewState.notificationTimer) clearTimeout(viewState.notificationTimer);
	viewState.notification = {
		message: `${success ? "✓" : "✗"} ${message}`,
		expiresAt: Date.now() + 2000,
	};
	viewState.notificationTimer = setTimeout(() => {
		viewState.notificationTimer = null;
		tui.requestRender();
	}, 2000);
}

/**
 * Format size in chars to human-readable string.
 */
export function formatSize(chars: number): string {
	if (chars < 1000) return `${chars} chars`;
	if (chars < 1_000_000) return `${(chars / 1000).toFixed(1)}k chars`;
	return `${(chars / 1_000_000).toFixed(1)}M chars`;
}
