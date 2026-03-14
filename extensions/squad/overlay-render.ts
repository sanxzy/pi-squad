/**
 * Squad Extension - Overlay Rendering Functions
 *
 * Provides rendering functions for the squad overlay UI sections:
 * - Status bar with progress indicators
 * - Member list with mini session cards
 * - Member detail with rich sections
 * - Member output as terminal window
 * - Sessions grid for multi-panel view
 * - Legend/footer
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { MemberStatus, SquadManager, SquadMemberInstance } from "./manager";
import type { SquadViewState } from "./overlay-actions";
import { formatSize } from "./overlay-actions";

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

/** Spinner frames for running animation. */
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function getSpinnerFrame(): string {
	return SPINNER[Math.floor(Date.now() / 100) % SPINNER.length]!;
}

function statusColor(status: MemberStatus): "success" | "error" | "accent" | "warning" | "dim" {
	switch (status) {
		case "completed":
			return "success";
		case "error":
		case "timeout":
			return "error";
		case "running":
		case "spawning":
			return "accent";
		case "aborted":
			return "warning";
		default:
			return "dim";
	}
}

/** Rotating color palette for member identity — each member gets its own color. */
const MEMBER_COLORS: Array<"accent" | "success" | "warning" | "error" | "muted"> = [
	"accent",
	"success",
	"warning",
	"error",
	"muted",
];

function memberColor(index: number): "accent" | "success" | "warning" | "error" | "muted" {
	return MEMBER_COLORS[index % MEMBER_COLORS.length]!;
}

function formatElapsed(ms: number): string {
	const sec = ms / 1000;
	if (sec < 60) return `${sec.toFixed(0)}s`;
	const min = Math.floor(sec / 60);
	const remaining = Math.floor(sec % 60);
	return `${min}m${remaining.toString().padStart(2, "0")}s`;
}

function makeProgressBar(ratio: number, barWidth: number, theme: Theme): string {
	const clamped = Math.max(0, Math.min(1, ratio));
	const filled = Math.round(clamped * barWidth);
	const empty = barWidth - filled;
	return theme.fg("accent", "█".repeat(filled)) + theme.fg("dim", "░".repeat(empty));
}

// ── Status Bar ──────────────────────────────────────────

export function renderOverlayStatusBar(theme: Theme, manager: SquadManager, width: number): string {
	const members = Array.from(manager.getMembers().values());
	if (members.length === 0) {
		return theme.fg("dim", "  ⚙  No squad members configured");
	}

	const total = members.length;
	const running = members.filter((m) => m.status === "running" || m.status === "spawning").length;
	const completed = members.filter((m) => m.status === "completed").length;
	const failed = members.filter((m) => m.status === "error" || m.status === "timeout").length;
	const idle = members.filter((m) => m.status === "idle").length;

	// Progress bar
	const doneRatio = total > 0 ? (completed + failed) / total : 0;
	const bar = makeProgressBar(doneRatio, 12, theme);

	const parts: string[] = [];
	parts.push(bar);
	parts.push(theme.fg("dim", `${completed + failed}/${total}`));
	if (running > 0) parts.push(theme.fg("accent", `${getSpinnerFrame()} ${running} active`));
	if (completed > 0) parts.push(theme.fg("success", `✓${completed}`));
	if (failed > 0) parts.push(theme.fg("error", `✗${failed}`));
	if (idle > 0) parts.push(theme.fg("dim", `○${idle}`));

	return truncateToWidth(parts.join("  "), width);
}

// ── Member List View (Tab Bar + Session Window) ─────────

export function renderMemberList(
	theme: Theme,
	manager: SquadManager,
	width: number,
	height: number,
	viewState: SquadViewState,
): string[] {
	const members = Array.from(manager.getMembers().values());
	const lines: string[] = [];

	if (members.length === 0) {
		lines.push("");
		lines.push(theme.fg("dim", "  ┌──────────────────────────────────┐"));
		lines.push(theme.fg("dim", "  │   No squad members found.       │"));
		lines.push(theme.fg("dim", "  │                                  │"));
		lines.push(theme.fg("dim", "  │   Add .md files to .pi/squad/   │"));
		lines.push(theme.fg("dim", "  │   to define squad members.      │"));
		lines.push(theme.fg("dim", "  └──────────────────────────────────┘"));
		while (lines.length < height) lines.push("");
		return lines.slice(0, height);
	}

	viewState.selectedIndex = Math.max(0, Math.min(viewState.selectedIndex, members.length - 1));

	// ── Tab Bar ──
	const tabLine = renderTabBar(theme, members, viewState.selectedIndex, width);
	lines.push(tabLine);

	// ── Active tab underline ──
	const activeColor = memberColor(viewState.selectedIndex);
	lines.push(theme.fg(activeColor, "━".repeat(width)))

	// ── Session content for selected member ──
	const member = members[viewState.selectedIndex]!;
	const mc = activeColor;
	const contentHeight = height - 2; // tab bar + underline
	const sessionLines = renderTabSession(theme, member, mc, width, contentHeight, viewState);
	lines.push(...sessionLines);

	while (lines.length < height) lines.push("");
	return lines.slice(0, height);
}

function renderTabBar(theme: Theme, members: SquadMemberInstance[], selectedIndex: number, width: number): string {
	if (members.length === 0) return "";

	const tabWidth = Math.floor(width / members.length);
	const tabs: string[] = [];

	for (let i = 0; i < members.length; i++) {
		const member = members[i]!;
		const mc = memberColor(i);
		const icon = STATUS_ICONS[member.status] || "?";
		const isSelected = i === selectedIndex;

		// Build tab content: icon + name
		const tabContent = `${icon} ${member.config.name}`;
		const contentW = visibleWidth(tabContent);

		// Calculate padding for full-width tab
		const leftPad = Math.floor((tabWidth - contentW) / 2);
		const rightPad = Math.max(0, tabWidth - contentW - leftPad);

		if (isSelected) {
			// Active tab: colored background with centered content
			const leftFill = theme.fg(mc, "━".repeat(Math.min(leftPad, tabWidth)));
			const content = theme.fg(mc, tabContent);
			const rightFill = theme.fg(mc, "━".repeat(Math.min(rightPad, tabWidth - contentW - leftPad)));
			tabs.push(leftFill + content + rightFill);
		} else {
			// Inactive tab: dimmed with centered content
			const leftFill = theme.fg("dim", "─".repeat(Math.min(leftPad, tabWidth)));
			const content = theme.fg("dim", tabContent);
			const rightFill = theme.fg("dim", "─".repeat(Math.min(rightPad, tabWidth - contentW - leftPad)));
			tabs.push(leftFill + content + rightFill);
		}
	}

	return tabs.join("");
}

function renderTabSession(
	theme: Theme,
	member: SquadMemberInstance,
	mc: "accent" | "success" | "warning" | "error" | "muted",
	width: number,
	height: number,
	_viewState: SquadViewState,
): string[] {
	const lines: string[] = [];

	// ── Info bar: status + role (line 1) and elapsed + output size (line 2) ──
	const icon = theme.fg(statusColor(member.status), STATUS_ICONS[member.status] || "?");
	const infoLeft = `${icon} ${theme.fg(mc, member.config.name)} ${theme.fg("dim", `(${member.config.role})`)}`;
	lines.push(truncateToWidth(infoLeft, width));

	// Second line: status info (elapsed, progress, done, etc.) - full width
	let infoRight = "";
	if (member.startedAt && (member.status === "running" || member.status === "spawning")) {
		const elapsed = formatElapsed(Date.now() - member.startedAt);
		const spinner = theme.fg(mc, getSpinnerFrame());
		const timeoutMs = member.config.timeout;
		const ratio = (Date.now() - member.startedAt) / timeoutMs;
		// Fixed width progress bar
		const prefix = `${spinner} ${theme.fg("dim", elapsed)} `;
		const barWidth = 10;
		const bar = makeProgressBar(ratio, barWidth, theme);
		infoRight = `${prefix}${bar}`;
	} else if (member.status === "completed" && member.output) {
		infoRight = theme.fg("success", "✓ done") + theme.fg("dim", ` · ${formatSize(member.output.length)}`);
	} else if (member.status === "error" || member.status === "timeout") {
		infoRight = theme.fg("error", `✗ ${member.status}`);
	} else if (member.status === "aborted") {
		infoRight = theme.fg("warning", "⊘ aborted");
	} else {
		infoRight = theme.fg("dim", "idle");
	}

	lines.push(truncateToWidth(infoRight, width));

	// ── Bottom separator line (full width) ──
	lines.push(theme.fg(mc, "─".repeat(width)));

	// ── Session output area ──
	const outputAreaHeight = height - lines.length;
	const outputLines: string[] = [];

	if (member.error) {
		outputLines.push(theme.fg("error", `  ⚠ ${member.error}`));
		outputLines.push("");
	}

	if (!member.output) {
		if (member.status === "running" || member.status === "spawning") {
			outputLines.push("");
			outputLines.push(theme.fg(mc, `  ${getSpinnerFrame()} Waiting for output...`));
			outputLines.push("");
		} else if (member.lastPrompt) {
			outputLines.push(theme.fg("dim", "  Last prompt:"));
			const promptPreview = member.lastPrompt.split("\n").slice(0, 4);
			for (const pl of promptPreview) {
				outputLines.push(theme.fg("dim", `    ${truncateToWidth(pl, width - 6)}`));
			}
		} else {
			outputLines.push("");
			outputLines.push(theme.fg("dim", "  (no output — dispatch a prompt to this member)"));
			outputLines.push("");
		}
	} else {
		// Show the tail of the output with line numbers
		const raw = member.output.split("\n");
		const totalLines = raw.length;
		const visibleCount = Math.min(outputAreaHeight, totalLines);
		const startLine = Math.max(0, totalLines - visibleCount);
		const gutterW = String(totalLines).length;

		for (let i = startLine; i < totalLines; i++) {
			const num = theme.fg("dim", `${String(i + 1).padStart(gutterW)} │ `);
			outputLines.push(num + truncateToWidth(raw[i]!, width - gutterW - 4));
		}

		// Show scroll hint if there's more above
		if (startLine > 0) {
			const scrollHint = theme.fg(
				"dim",
				`  ↑ ${startLine} more line${startLine > 1 ? "s" : ""} above — press Enter for full view`,
			);
			outputLines.unshift(scrollHint);
		}
	}

	// Pad to fill
	while (outputLines.length < outputAreaHeight) outputLines.push("");
	lines.push(...outputLines.slice(0, outputAreaHeight));

	return lines;
}

// ── Member Detail View ──────────────────────────────────

export function renderMemberDetail(
	theme: Theme,
	member: SquadMemberInstance,
	width: number,
	height: number,
	viewState: SquadViewState,
): string[] {
	const lines: string[] = [];
	const color = statusColor(member.status);
	const icon = theme.fg(color, STATUS_ICONS[member.status] || "?");

	// ── Rich Header ──
	lines.push(theme.fg("dim", `╔${"═".repeat(Math.min(width - 2, 70))}╗`));
	const headerContent = ` ${icon} ${theme.fg("accent", member.config.name)} ${theme.fg("dim", "·")} ${theme.fg(color, member.status.toUpperCase())} `;
	const headerW = visibleWidth(headerContent);
	const headerPad = " ".repeat(Math.max(0, Math.min(width - 2, 70) - headerW));
	lines.push(theme.fg("dim", "║") + headerContent + headerPad + theme.fg("dim", "║"));
	lines.push(theme.fg("dim", `╚${"═".repeat(Math.min(width - 2, 70))}╝`));
	lines.push("");

	// ── Config Grid ──
	lines.push(theme.fg("accent", "  ╭─ Configuration ─────────────────"));
	const configPairs: [string, string][] = [
		["Role", member.config.role],
		["Model", member.config.model || "default"],
		["Tools", member.config.tools || "all"],
		["Thinking", member.config.thinking],
		["Timeout", `${(member.config.timeout / 1000).toFixed(0)}s`],
		["Scope", member.config.scope],
	];
	for (const [key, val] of configPairs) {
		const label = theme.fg("dim", `  │  ${key.padEnd(10)}`);
		lines.push(`${label}${val}`);
	}
	lines.push(theme.fg("dim", "  ╰────────────────────────────────"));
	lines.push("");

	// ── Progress Section ──
	if (member.startedAt) {
		lines.push(theme.fg("accent", "  ╭─ Progress ──────────────────────"));
		const elapsed = Date.now() - member.startedAt;
		const elapsedStr = formatElapsed(elapsed);
		const timeoutMs = member.config.timeout;
		const ratio = elapsed / timeoutMs;
		const bar = makeProgressBar(ratio, 20, theme);

		if (member.status === "running" || member.status === "spawning") {
			lines.push(
				`  ${theme.fg("dim", "│")}  ${theme.fg("accent", getSpinnerFrame())} Elapsed: ${elapsedStr} / ${formatElapsed(timeoutMs)}`,
			);
			lines.push(`  ${theme.fg("dim", "│")}  ${bar} ${(ratio * 100).toFixed(0)}%`);
		} else {
			lines.push(`  ${theme.fg("dim", "│")}  Duration: ${elapsedStr}`);
		}

		if (member.output) {
			lines.push(
				`  ${theme.fg("dim", "│")}  Output: ${formatSize(member.output.length)} (${member.output.split("\n").length} lines)`,
			);
		}
		lines.push(theme.fg("dim", "  ╰────────────────────────────────"));
		lines.push("");
	}

	// ── Error Alert Box ──
	if (member.error) {
		lines.push(theme.fg("error", "  ╭─ ⚠ Error ──────────────────────"));
		for (const errLine of member.error.split("\n")) {
			lines.push(`${theme.fg("error", "  │")}  ${errLine}`);
		}
		lines.push(theme.fg("error", "  ╰────────────────────────────────"));
		lines.push("");
	}

	// ── Last Prompt ──
	if (member.lastPrompt) {
		lines.push(theme.fg("accent", "  ╭─ Last Prompt ───────────────────"));
		const promptLines = member.lastPrompt.split("\n");
		for (const line of promptLines.slice(0, 6)) {
			lines.push(`${theme.fg("dim", "  │")}  ${truncateToWidth(line, width - 6)}`);
		}
		if (promptLines.length > 6) {
			lines.push(theme.fg("dim", `  │  ... ${promptLines.length - 6} more lines`));
		}
		lines.push(theme.fg("dim", "  ╰────────────────────────────────"));
		lines.push("");
	}

	// ── Output Preview Sub-box ──
	if (member.output) {
		lines.push(theme.fg("accent", "  ╭─ Output Preview ") + theme.fg("dim", "(press 'o' for full) ─"));
		const preview = member.output.slice(-600);
		const previewLines = preview.split("\n").slice(-10);
		for (const line of previewLines) {
			lines.push(theme.fg("dim", "  │ ") + truncateToWidth(line, width - 6));
		}
		lines.push(theme.fg("dim", "  ╰────────────────────────────────"));
	}

	// Scrolling
	const maxScroll = Math.max(0, lines.length - height);
	viewState.detailScroll = Math.max(0, Math.min(viewState.detailScroll, maxScroll));
	const visible = lines
		.slice(viewState.detailScroll, viewState.detailScroll + height)
		.map((line) => truncateToWidth(line, width));
	while (visible.length < height) visible.push("");
	return visible;
}

// ── Full Output View (Terminal Window) ──────────────────

export function renderMemberOutput(
	theme: Theme,
	member: SquadMemberInstance,
	width: number,
	height: number,
	viewState: SquadViewState,
): string[] {
	const lines: string[] = [];
	const color = statusColor(member.status);
	const icon = theme.fg(color, STATUS_ICONS[member.status] || "?");

	// ── Terminal-style title bar ──
	const titleContent = ` ${icon} ${member.config.name} `;
	const titleW = visibleWidth(titleContent);

	let rightInfo = "";
	if (member.status === "running" || member.status === "spawning") {
		rightInfo = theme.fg("accent", ` ${getSpinnerFrame()} LIVE `);
	} else if (member.status === "completed") {
		rightInfo = theme.fg("success", " ✓ DONE ");
	} else if (member.status === "error" || member.status === "timeout") {
		rightInfo = theme.fg("error", " ✗ ERROR ");
	}
	const rightW = visibleWidth(rightInfo);
	const titleBarFill = Math.max(0, width - titleW - rightW - 4);
	lines.push(
		theme.fg("accent", "┏━") +
			titleContent +
			theme.fg("accent", "━".repeat(titleBarFill)) +
			rightInfo +
			theme.fg("accent", "━┓"),
	);

	// ── Stats line ──
	let statsContent = "";
	if (member.output) {
		const lineCount = member.output.split("\n").length;
		statsContent += theme.fg("dim", ` ${formatSize(member.output.length)} · ${lineCount} lines`);
	}
	if (member.startedAt) {
		const elapsed = formatElapsed(Date.now() - member.startedAt);
		statsContent += theme.fg("dim", ` · ${elapsed}`);
	}
	const statsW = visibleWidth(statsContent);
	const statsPad = " ".repeat(Math.max(0, width - statsW - 4));
	lines.push(theme.fg("accent", "┃") + statsContent + statsPad + theme.fg("accent", "┃"));
	lines.push(theme.fg("accent", "┠") + theme.fg("dim", "─".repeat(width - 2)) + theme.fg("accent", "┨"));

	// ── Output content with line numbers ──
	const contentHeight = height - 4; // title + stats + separator + bottom
	const outputLines: string[] = [];
	const gutterW = 4; // line number gutter

	if (!member.output) {
		outputLines.push(theme.fg("dim", "    (no output yet)"));
		if (member.status === "running" || member.status === "spawning") {
			outputLines.push("");
			outputLines.push(theme.fg("accent", `    ${getSpinnerFrame()} Waiting for output...`));
		}
	} else {
		const raw = member.output.split("\n");
		for (let i = 0; i < raw.length; i++) {
			const lineNum = theme.fg("dim", `${String(i + 1).padStart(gutterW)} │ `);
			outputLines.push(lineNum + truncateToWidth(raw[i]!, width - gutterW - 5));
		}
	}

	// Auto-scroll for running members
	const maxScroll = Math.max(0, outputLines.length - contentHeight);
	if (viewState.detailAutoScroll && (member.status === "running" || member.status === "spawning")) {
		viewState.detailScroll = maxScroll;
	}
	viewState.detailScroll = Math.max(0, Math.min(viewState.detailScroll, maxScroll));

	// Render visible lines with scroll indicator
	const visibleOutput = outputLines.slice(viewState.detailScroll, viewState.detailScroll + contentHeight);
	while (visibleOutput.length < contentHeight) visibleOutput.push("");

	const totalOutputLines = outputLines.length;
	for (let i = 0; i < visibleOutput.length; i++) {
		// Scroll indicator on right edge
		let scrollChar = " ";
		if (totalOutputLines > contentHeight) {
			const scrollPos = totalOutputLines > 0 ? (viewState.detailScroll + i) / totalOutputLines : 0;
			const thumbPos = Math.floor(scrollPos * contentHeight);
			const thumbSize = Math.max(1, Math.floor((contentHeight / totalOutputLines) * contentHeight));
			if (i >= thumbPos && i < thumbPos + thumbSize) {
				scrollChar = theme.fg("accent", "▐");
			} else {
				scrollChar = theme.fg("dim", "░");
			}
		}
		const lineContent = truncateToWidth(visibleOutput[i]!, width - 4);
		const lineW = visibleWidth(lineContent);
		const linePad = " ".repeat(Math.max(0, width - lineW - 4));
		lines.push(theme.fg("accent", "┃") + lineContent + linePad + scrollChar + theme.fg("accent", "┃"));
	}

	// Bottom bar
	lines.push(theme.fg("accent", "┗") + theme.fg("accent", "━".repeat(width - 2)) + theme.fg("accent", "┛"));

	return lines.slice(0, height);
}

// ── Member Chat View (WhatsApp-style) ───────────────────

interface ChatMessage {
	id: string;
	from: string;
	to: string;
	content: string;
	timestamp: string;
	status: "read" | "unread";
	direction: "incoming" | "outgoing";
}

function loadChatMessages(cwd: string, memberRole: string): ChatMessage[] {
	const messagesFile = join(cwd, ".pi", "messenger", memberRole, "messages.jsonl");
	if (!existsSync(messagesFile)) return [];

	const content = readFileSync(messagesFile, "utf-8");
	const lines = content.split("\n").filter((line) => line.trim());
	const messages: ChatMessage[] = [];

	for (const line of lines) {
		try {
			const parsed = JSON.parse(line);
			if (parsed.id && parsed.from && parsed.to && parsed.content && parsed.timestamp) {
				messages.push(parsed as ChatMessage);
			}
		} catch {
			continue;
		}
	}

	return messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function formatChatTime(timestamp: string): string {
	const d = new Date(timestamp);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function wrapText(text: string, maxWidth: number): string[] {
	const result: string[] = [];
	for (const paragraph of text.split("\n")) {
		if (paragraph.length === 0) {
			result.push("");
			continue;
		}
		let remaining = paragraph;
		while (remaining.length > maxWidth) {
			let breakPoint = remaining.lastIndexOf(" ", maxWidth);
			if (breakPoint <= 0) breakPoint = maxWidth;
			result.push(remaining.slice(0, breakPoint));
			remaining = remaining.slice(breakPoint).trimStart();
		}
		if (remaining.length > 0) result.push(remaining);
	}
	return result;
}

export function renderMemberChat(
	theme: Theme,
	member: SquadMemberInstance,
	cwd: string,
	width: number,
	height: number,
	viewState: SquadViewState,
): string[] {
	const lines: string[] = [];
	const memberRole = member.config.role;
	const memberName = member.config.name;

	// ── Chat Header ──
	const headerContent = ` 💬 ${theme.fg("accent", memberName)} ${theme.fg("dim", `(${memberRole})`)} `;
	const headerW = visibleWidth(headerContent);
	const headerFill = Math.max(0, width - headerW - 4);
	lines.push(
		theme.fg("accent", "┏━") +
			headerContent +
			theme.fg("accent", "━".repeat(headerFill)) +
			theme.fg("accent", "━┓"),
	);

	// ── Input area (bottom 3 lines reserved) ──
	const inputHeight = viewState.chatInputFocused ? 3 : 1;
	const chatAreaHeight = height - 2 - inputHeight; // header + separator + input

	// ── Load messages ──
	const messages = loadChatMessages(cwd, memberRole);

	if (messages.length === 0) {
		// Empty state
		const emptyLines: string[] = [];
		emptyLines.push("");
		emptyLines.push(theme.fg("dim", "  No messages yet."));
		emptyLines.push(theme.fg("dim", `  Press 'i' to start chatting with ${memberName}`));
		emptyLines.push("");

		while (emptyLines.length < chatAreaHeight) emptyLines.push("");
		for (const el of emptyLines.slice(0, chatAreaHeight)) {
			const elW = visibleWidth(el);
			const elPad = " ".repeat(Math.max(0, width - elW - 2));
			lines.push(theme.fg("accent", "┃") + el + elPad + theme.fg("accent", "┃"));
		}
	} else {
		// ── Render chat bubbles ──
		const bubbleLines: string[] = [];
		const maxBubbleW = Math.min(Math.floor(width * 0.7), width - 12);
		let lastDate = "";

		for (const msg of messages) {
			// Date separator
			const msgDate = new Date(msg.timestamp).toLocaleDateString();
			if (msgDate !== lastDate) {
				lastDate = msgDate;
				const dateSep = ` ${msgDate} `;
				const datePadL = Math.floor((width - 4 - dateSep.length) / 2);
				const datePadR = width - 4 - dateSep.length - datePadL;
				bubbleLines.push(
					theme.fg("dim", "─".repeat(Math.max(0, datePadL))) +
						theme.fg("dim", dateSep) +
						theme.fg("dim", "─".repeat(Math.max(0, datePadR))),
				);
			}

			const isOutgoing = msg.direction === "outgoing";
			const time = formatChatTime(msg.timestamp);
			const statusIcon = msg.status === "read" ? "✓✓" : "✓";
			const senderLabel = isOutgoing
				? theme.fg("accent", memberName)
				: theme.fg("success", msg.from);

			// Wrap message content
			const contentLines = wrapText(msg.content, maxBubbleW - 2);

			// Build bubble
			const bubbleW = Math.min(
				maxBubbleW,
				Math.max(...contentLines.map((l) => l.length), 20) + 2,
			);

			// Bubble top + sender
			const topBorder = isOutgoing ? "╭" + "─".repeat(bubbleW) + "╮" : "╭" + "─".repeat(bubbleW) + "╮";
			const senderLine = `│ ${senderLabel}`;
			const senderPad = " ".repeat(Math.max(0, bubbleW - visibleWidth(senderLine) + 1));

			if (isOutgoing) {
				// Right-aligned
				const indent = Math.max(0, width - 4 - bubbleW - 2);
				bubbleLines.push(" ".repeat(indent) + theme.fg("accent", topBorder));
				bubbleLines.push(" ".repeat(indent) + theme.fg("accent", senderLine) + senderPad + theme.fg("accent", "│"));
			} else {
				// Left-aligned
				bubbleLines.push(theme.fg("success", topBorder));
				bubbleLines.push(theme.fg("success", senderLine) + senderPad + theme.fg("success", "│"));
			}

			// Content lines
			for (const cl of contentLines) {
				const clTrunc = truncateToWidth(cl, bubbleW - 2);
				const clW = visibleWidth(clTrunc);
				const clPad = " ".repeat(Math.max(0, bubbleW - clW - 2));
				const lineContent = `│ ${clTrunc}${clPad} │`;
				if (isOutgoing) {
					const indent = Math.max(0, width - 4 - bubbleW - 2);
					bubbleLines.push(" ".repeat(indent) + theme.fg("accent", lineContent));
				} else {
					bubbleLines.push(theme.fg("success", lineContent));
				}
			}

			// Bottom border with time
			const timeStr = `${time} ${isOutgoing ? statusIcon : ""}`.trim();
			const timePad = Math.max(0, bubbleW - timeStr.length - 1);
			const bottomBorder = `╰${"─".repeat(Math.max(0, timePad))}${theme.fg("dim", timeStr)}╯`;
			if (isOutgoing) {
				const indent = Math.max(0, width - 4 - bubbleW - 2);
				bubbleLines.push(" ".repeat(indent) + theme.fg("accent", bottomBorder));
			} else {
				bubbleLines.push(theme.fg("success", bottomBorder));
			}

			bubbleLines.push(""); // spacing between bubbles
		}

		// Auto-scroll
		const maxScroll = Math.max(0, bubbleLines.length - chatAreaHeight);
		if (viewState.chatAutoScroll) {
			viewState.chatScroll = maxScroll;
		}
		viewState.chatScroll = Math.max(0, Math.min(viewState.chatScroll, maxScroll));

		// Render visible lines with scroll indicator
		const visibleBubbles = bubbleLines.slice(viewState.chatScroll, viewState.chatScroll + chatAreaHeight);
		while (visibleBubbles.length < chatAreaHeight) visibleBubbles.push("");

		for (let i = 0; i < visibleBubbles.length; i++) {
			const bl = visibleBubbles[i]!;
			const blW = visibleWidth(bl);
			const blPad = " ".repeat(Math.max(0, width - blW - 4));

			// Scroll indicator
			let scrollChar = " ";
			if (bubbleLines.length > chatAreaHeight) {
				const scrollPos = bubbleLines.length > 0 ? (viewState.chatScroll + i) / bubbleLines.length : 0;
				const thumbPos = Math.floor(scrollPos * chatAreaHeight);
				const thumbSize = Math.max(1, Math.floor((chatAreaHeight / bubbleLines.length) * chatAreaHeight));
				if (i >= thumbPos && i < thumbPos + thumbSize) {
					scrollChar = theme.fg("accent", "▐");
				} else {
					scrollChar = theme.fg("dim", "░");
				}
			}

			lines.push(theme.fg("accent", "┃") + " " + bl + blPad + scrollChar + theme.fg("accent", "┃"));
		}
	}

	// ── Input separator ──
	lines.push(theme.fg("accent", "┠") + theme.fg("dim", "─".repeat(width - 2)) + theme.fg("accent", "┨"));

	// ── Input area ──
	if (viewState.chatInputFocused) {
		const cursor = theme.fg("accent", "█");
		const inputText = viewState.chatInput || "";
		const inputDisplay = truncateToWidth(inputText, width - 8);
		const promptLine = `  ${theme.fg("accent", "❯")} ${inputDisplay}${cursor}`;
		const promptW = visibleWidth(promptLine);
		const promptPad = " ".repeat(Math.max(0, width - promptW - 2));
		lines.push(theme.fg("accent", "┃") + promptLine + promptPad + theme.fg("accent", "┃"));

		const hintLine = theme.fg("dim", "  Enter:Send  Esc:Cancel");
		const hintW = visibleWidth(hintLine);
		const hintPad = " ".repeat(Math.max(0, width - hintW - 2));
		lines.push(theme.fg("accent", "┃") + hintLine + hintPad + theme.fg("accent", "┃"));
	} else {
		const hintLine = theme.fg("dim", "  Press 'i' to type a message");
		const hintW = visibleWidth(hintLine);
		const hintPad = " ".repeat(Math.max(0, width - hintW - 2));
		lines.push(theme.fg("accent", "┃") + hintLine + hintPad + theme.fg("accent", "┃"));
	}

	// ── Bottom border ──
	lines.push(theme.fg("accent", "┗") + theme.fg("accent", "━".repeat(width - 2)) + theme.fg("accent", "┛"));

	return lines.slice(0, height);
}

// ── Sessions Grid View ──────────────────────────────────

export function renderSessionsGrid(
	theme: Theme,
	manager: SquadManager,
	width: number,
	height: number,
	viewState: SquadViewState,
): string[] {
	const members = Array.from(manager.getMembers().values());
	if (members.length === 0) {
		const lines: string[] = [theme.fg("dim", "  No squad members to display.")];
		while (lines.length < height) lines.push("");
		return lines.slice(0, height);
	}

	const cols =
		members.length <= 2 ? members.length : members.length <= 4 ? 2 : Math.min(3, Math.ceil(Math.sqrt(members.length)));
	const rows = Math.ceil(members.length / cols);
	const panelW = Math.max(14, Math.floor(width / cols) - 1);
	const panelH = Math.max(5, Math.floor(height / rows));

	viewState.sessionsFocusIndex = Math.max(0, Math.min(viewState.sessionsFocusIndex, members.length - 1));

	const gridLines: string[] = [];

	for (let r = 0; r < rows; r++) {
		const panelLines: string[][] = [];
		for (let c = 0; c < cols; c++) {
			const idx = r * cols + c;
			if (idx < members.length) {
				panelLines.push(renderSessionPanel(theme, members[idx]!, panelW, panelH, idx === viewState.sessionsFocusIndex));
			} else {
				const empty: string[] = [];
				while (empty.length < panelH) empty.push(" ".repeat(panelW));
				panelLines.push(empty);
			}
		}

		for (let line = 0; line < panelH; line++) {
			const merged = panelLines
				.map((p) => {
					const l = p[line] ?? "";
					const pad = " ".repeat(Math.max(0, panelW - visibleWidth(l)));
					return l + pad;
				})
				.join(" ");
			gridLines.push(truncateToWidth(merged, width));
		}
	}

	while (gridLines.length < height) gridLines.push("");
	return gridLines.slice(0, height);
}

function renderSessionPanel(
	theme: Theme,
	member: SquadMemberInstance,
	width: number,
	height: number,
	isFocused: boolean,
): string[] {
	const innerW = Math.max(1, width - 2);
	const lines: string[] = [];
	const bc = isFocused ? "accent" : "dim";
	const icon = theme.fg(statusColor(member.status), STATUS_ICONS[member.status] || "?");

	// Top border
	const topChar = isFocused ? "━" : "─";
	lines.push(theme.fg(bc, isFocused ? `┏${topChar.repeat(innerW)}┓` : `┌${"─".repeat(innerW)}┐`));

	// Header: icon + name
	const nameStr = truncateToWidth(member.config.name, innerW - 4);
	let headerRight = "";
	if (member.startedAt && (member.status === "running" || member.status === "spawning")) {
		headerRight = theme.fg("accent", getSpinnerFrame());
	} else if (member.status === "completed") {
		headerRight = theme.fg("success", "✓");
	} else if (member.status === "error") {
		headerRight = theme.fg("error", "✗");
	}
	const headerContent = `${icon} ${nameStr}`;
	const headerContentW = visibleWidth(headerContent);
	const rightW = visibleWidth(headerRight);
	const headerGap = " ".repeat(Math.max(0, innerW - headerContentW - rightW));
	lines.push(
		theme.fg(bc, isFocused ? "┃" : "│") + headerContent + headerGap + headerRight + theme.fg(bc, isFocused ? "┃" : "│"),
	);

	// Status / elapsed line
	let statusLine = theme.fg("dim", member.status);
	if (member.startedAt && (member.status === "running" || member.status === "spawning")) {
		statusLine = theme.fg("dim", formatElapsed(Date.now() - member.startedAt));
	} else if (member.output) {
		statusLine = theme.fg("dim", formatSize(member.output.length));
	}
	const statusW = visibleWidth(statusLine);
	const statusPad = " ".repeat(Math.max(0, innerW - statusW));
	lines.push(theme.fg(bc, isFocused ? "┃" : "│") + statusLine + statusPad + theme.fg(bc, isFocused ? "┃" : "│"));

	// Separator
	lines.push(theme.fg(bc, isFocused ? `┠${"─".repeat(innerW)}┨` : `├${"─".repeat(innerW)}┤`));

	// Output tail
	const outputHeight = Math.max(1, height - 5);
	const outputLines: string[] = [];
	if (member.output) {
		const raw = member.output.split("\n").slice(-outputHeight);
		for (const l of raw) {
			outputLines.push(truncateToWidth(l, innerW));
		}
	}
	if (member.error) {
		outputLines.push(theme.fg("error", member.error.slice(0, innerW)));
	}
	if (outputLines.length === 0) {
		if (member.status === "running" || member.status === "spawning") {
			outputLines.push(theme.fg("dim", `${getSpinnerFrame()} waiting...`));
		} else {
			outputLines.push(theme.fg("dim", "(no output)"));
		}
	}
	while (outputLines.length < outputHeight) outputLines.push("");

	for (const ol of outputLines.slice(0, outputHeight)) {
		const olW = visibleWidth(ol);
		const olPad = " ".repeat(Math.max(0, innerW - olW));
		lines.push(theme.fg(bc, isFocused ? "┃" : "│") + ol + olPad + theme.fg(bc, isFocused ? "┃" : "│"));
	}

	// Bottom border
	const botChar = isFocused ? "━" : "─";
	lines.push(theme.fg(bc, isFocused ? `┗${botChar.repeat(innerW)}┛` : `└${"─".repeat(innerW)}┘`));

	return lines.slice(0, height);
}

// ── Legend (Footer) ─────────────────────────────────────

export function renderOverlayLegend(
	theme: Theme,
	viewState: SquadViewState,
	selectedMember: SquadMemberInstance | null,
	width: number,
): string {
	// Confirmation mode
	if (viewState.confirmAction) {
		const text = `⚠ ${viewState.confirmAction.type} ${viewState.confirmAction.label}?  ${theme.fg("success", "[y]")} Confirm  ${theme.fg("error", "[n]")} Cancel`;
		return truncateToWidth(theme.fg("warning", text), width);
	}

	// Notification
	if (viewState.notification && Date.now() < viewState.notification.expiresAt) {
		return truncateToWidth(theme.fg("accent", viewState.notification.message), width);
	}

	// Prompt input mode
	if (viewState.inputMode === "prompt") {
		const cursor = theme.fg("accent", "█");
		const text = `${theme.fg("dim", "❯")} ${viewState.promptInput}${cursor}`;
		return truncateToWidth(text, width);
	}

	const sep = theme.fg("dim", " │ ");

	// Sessions grid view
	if (viewState.mode === "sessions") {
		return truncateToWidth(
			theme.fg("dim", "←→↑↓") +
				theme.fg("muted", ":Focus") +
				sep +
				theme.fg("dim", "Enter") +
				theme.fg("muted", ":Open") +
				sep +
				theme.fg("dim", "p") +
				theme.fg("muted", ":Prompt") +
				sep +
				theme.fg("dim", "^T") +
				theme.fg("muted", ":Snap") +
				sep +
				theme.fg("dim", "Esc") +
				theme.fg("muted", ":Back"),
			width,
		);
	}

	// Chat view
	if (viewState.mode === "chat") {
		const parts: string[] = [];
		parts.push(theme.fg("dim", "Esc") + theme.fg("muted", ":Back"));
		parts.push(theme.fg("dim", "↑↓") + theme.fg("muted", ":Scroll"));
		parts.push(theme.fg("dim", "i") + theme.fg("muted", ":Type"));
		parts.push(theme.fg("dim", "^T") + theme.fg("muted", ":Snapshot"));
		return truncateToWidth(parts.join(sep), width);
	}

	// Detail/output view (scrolling with up/down)
	if (viewState.mode === "detail" || viewState.mode === "output") {
		const parts: string[] = [];
		parts.push(theme.fg("dim", "Esc") + theme.fg("muted", ":Back"));
		parts.push(theme.fg("dim", "↑↓") + theme.fg("muted", ":Scroll"));
		if (viewState.mode === "detail") parts.push(theme.fg("dim", "o") + theme.fg("muted", ":FullOutput"));
		if (selectedMember?.status === "running") parts.push(theme.fg("dim", "a") + theme.fg("muted", ":Abort"));
		if (selectedMember?.lastPrompt) parts.push(theme.fg("dim", "r") + theme.fg("muted", ":Redo"));
		parts.push(theme.fg("dim", "p") + theme.fg("muted", ":Prompt"));
		parts.push(theme.fg("dim", "^T") + theme.fg("muted", ":Snapshot"));
		return truncateToWidth(parts.join(sep), width);
	}

	// List view (tab-based navigation)
	const parts: string[] = [];
	parts.push(theme.fg("dim", "←→") + theme.fg("muted", ":Tabs"));
	parts.push(theme.fg("dim", "Enter") + theme.fg("muted", ":Detail"));
	parts.push(theme.fg("dim", "o") + theme.fg("muted", ":Output"));
	parts.push(theme.fg("dim", "s") + theme.fg("muted", ":Grid"));
	parts.push(theme.fg("dim", "c") + theme.fg("muted", ":Chat"));
	parts.push(theme.fg("dim", "p") + theme.fg("muted", ":Prompt"));
	parts.push(theme.fg("dim", "P") + theme.fg("muted", ":All"));
	if (selectedMember?.status === "running") parts.push(theme.fg("dim", "a") + theme.fg("muted", ":Abort"));
	if (selectedMember?.lastPrompt) parts.push(theme.fg("dim", "r") + theme.fg("muted", ":Redo"));
	parts.push(theme.fg("dim", "Esc") + theme.fg("muted", ":Close"));
	return truncateToWidth(parts.join(sep), width);
}
