/**
 * Messenger Extension - Storage Module
 *
 * Handles message storage using JSONL format:
 * - Per-member directory structure in .pi/messenger/<name>/
 * - Atomic writes via temp file + rename
 * - Streaming reads for large conversations
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Contact, Conversation, Message, MessageStatus, StoragePaths } from "./types.js";

/**
 * Generate a unique message ID.
 * Format: msg_<timestamp>_<random>
 */
export function generateMessageId(): string {
	return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Get storage paths for a given agent name and working directory.
 *
 * @param cwd - Current working directory
 * @param agentName - Agent's unique name
 * @returns Storage paths configuration
 */
export function getStoragePaths(cwd: string, agentName: string): StoragePaths {
	const messengerDir = join(cwd, ".pi", "messenger");
	const agentDir = join(messengerDir, agentName);
	const messagesFile = join(agentDir, "messages.jsonl");

	return {
		messengerDir,
		agentDir,
		messagesFile,
	};
}

/**
 * Ensure storage directories exist.
 * Creates .pi/messenger/<name>/ if it doesn't exist.
 *
 * @param paths - Storage paths configuration
 */
export function ensureStorageDirs(paths: StoragePaths): void {
	if (!existsSync(paths.messengerDir)) {
		mkdirSync(paths.messengerDir, { recursive: true });
	}
	if (!existsSync(paths.agentDir)) {
		mkdirSync(paths.agentDir, { recursive: true });
	}
}

/**
 * Append a message to the agent's message store.
 * Uses atomic write via temp file + rename for crash safety.
 *
 * @param paths - Storage paths configuration
 * @param message - Message to append
 */
export function appendMessage(paths: StoragePaths, message: Message): void {
	ensureStorageDirs(paths);

	const tempFile = `${paths.messagesFile}.tmp`;
	const line = JSON.stringify(message) + "\n";

	// Read existing content if file exists
	let existingContent = "";
	if (existsSync(paths.messagesFile)) {
		existingContent = readFileSync(paths.messagesFile, "utf-8");
	}

	// Write to temp file, then rename (atomic on most filesystems)
	writeFileSync(tempFile, existingContent + line, "utf-8");
	renameSync(tempFile, paths.messagesFile);
}

/**
 * Read all messages from an agent's message store.
 * Returns messages sorted by timestamp (oldest first).
 *
 * @param paths - Storage paths configuration
 * @returns Array of messages
 */
export function readAllMessages(paths: StoragePaths): Message[] {
	if (!existsSync(paths.messagesFile)) {
		return [];
	}

	const content = readFileSync(paths.messagesFile, "utf-8");
	const lines = content.split("\n").filter((line) => line.trim());

	const messages: Message[] = [];
	for (const line of lines) {
		try {
			const parsed = JSON.parse(line);
			// Validate required fields
			if (parsed.id && parsed.from && parsed.to && parsed.content && parsed.timestamp) {
				messages.push(parsed as Message);
			}
		} catch {
			// Skip malformed lines
			continue;
		}
	}

	// Sort by timestamp, oldest first
	return messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/**
 * Read messages for a specific conversation (with a specific contact).
 * Filters messages between this agent and the specified contact.
 *
 * @param paths - Storage paths configuration
 * @param agentName - Current agent's name
 * @param contactName - Contact's name
 * @returns Array of messages in the conversation
 */
export function readConversation(paths: StoragePaths, agentName: string, contactName: string): Message[] {
	const allMessages = readAllMessages(paths);

	return allMessages.filter(
		(msg) =>
			(msg.from === agentName && msg.to === contactName) ||
			(msg.from === contactName && msg.to === agentName),
	);
}

/**
 * Get unread message count from a specific contact.
 *
 * @param paths - Storage paths configuration
 * @param agentName - Current agent's name
 * @param contactName - Contact's name
 * @returns Count of unread messages from this contact
 */
export function getUnreadCount(paths: StoragePaths, agentName: string, contactName: string): number {
	const messages = readConversation(paths, agentName, contactName);

	// Count incoming messages that are unread
	return messages.filter((msg) => msg.from === contactName && msg.to === agentName && msg.status === "unread").length;
}

/**
 * Get unread counts for all contacts.
 *
 * @param paths - Storage paths configuration
 * @param agentName - Current agent's name
 * @param contacts - List of contacts to check
 * @returns Map of contact name to unread count
 */
export function getAllUnreadCounts(
	paths: StoragePaths,
	agentName: string,
	contacts: Contact[],
): Map<string, number> {
	const counts = new Map<string, number>();

	for (const contact of contacts) {
		counts.set(contact.name, getUnreadCount(paths, agentName, contact.name));
	}

	return counts;
}

/**
 * Mark all messages from a specific contact as read.
 * Updates the status field in the JSONL file.
 *
 * @param paths - Storage paths configuration
 * @param agentName - Current agent's name
 * @param contactName - Contact's name
 * @returns Number of messages marked as read
 */
export function markConversationAsRead(paths: StoragePaths, agentName: string, contactName: string): number {
	const messages = readAllMessages(paths);

	let markedCount = 0;
	const updatedMessages: Message[] = [];

	for (const msg of messages) {
		// Only update incoming messages from the contact that are unread
		if (msg.from === contactName && msg.to === agentName && msg.status === "unread") {
			updatedMessages.push({ ...msg, status: "read" as MessageStatus });
			markedCount++;
		} else {
			updatedMessages.push(msg);
		}
	}

	if (markedCount > 0) {
		// Rewrite the entire file with updated messages
		const tempFile = `${paths.messagesFile}.tmp`;
		const content = updatedMessages.map((msg) => JSON.stringify(msg)).join("\n") + "\n";
		writeFileSync(tempFile, content, "utf-8");
		renameSync(tempFile, paths.messagesFile);
	}

	return markedCount;
}

/**
 * Get a conversation object with all metadata.
 *
 * @param paths - Storage paths configuration
 * @param agentName - Current agent's name
 * @param contact - Contact to get conversation with
 * @returns Conversation object
 */
export function getConversation(paths: StoragePaths, agentName: string, contact: Contact): Conversation {
	const messages = readConversation(paths, agentName, contact.name);
	const unreadCount = messages.filter((msg) => msg.from === contact.name && msg.status === "unread").length;

	let lastMessageAt: string | undefined;
	if (messages.length > 0) {
		lastMessageAt = messages[messages.length - 1]!.timestamp;
	}

	return {
		contact: contact.name,
		messages,
		unreadCount,
		lastMessageAt,
	};
}

/**
 * Send a message to a contact.
 * Appends the message to both sender's and receiver's message stores.
 *
 * @param cwd - Current working directory
 * @param fromName - Sender's name
 * @param toName - Receiver's name
 * @param content - Message content
 * @param replyTo - Optional message ID being replied to
 * @returns The created message
 */
export function sendMessage(
	cwd: string,
	fromName: string,
	toName: string,
	content: string,
	replyTo?: string,
): Message {
	const timestamp = new Date().toISOString();
	const messageId = generateMessageId();

	const message: Message = {
		id: messageId,
		from: fromName,
		to: toName,
		content,
		timestamp,
		status: "unread",
		direction: "outgoing",
		replyTo,
	};

	// Save to sender's outbox
	const senderPaths = getStoragePaths(cwd, fromName);
	appendMessage(senderPaths, message);

	// Save to receiver's inbox
	const receiverPaths = getStoragePaths(cwd, toName);
	const receivedMessage: Message = {
		...message,
		direction: "incoming",
	};
	appendMessage(receiverPaths, receivedMessage);

	return message;
}

/**
 * Search messages by content (case-insensitive).
 *
 * @param paths - Storage paths configuration
 * @param agentName - Current agent's name
 * @param query - Search query string
 * @param limit - Maximum number of results (default: 50)
 * @returns Array of matching messages
 */
export function searchMessages(
	paths: StoragePaths,
	agentName: string,
	query: string,
	limit: number = 50,
): Message[] {
	const allMessages = readAllMessages(paths);

	// Filter messages involving this agent
	const myMessages = allMessages.filter(
		(msg) => msg.from === agentName || msg.to === agentName,
	);

	// Search in content (case-insensitive)
	const lowerQuery = query.toLowerCase();
	const matching = myMessages
		.filter((msg) => msg.content.toLowerCase().includes(lowerQuery))
		.slice(0, limit);

	return matching;
}

/**
 * Get the list of all agent directories in messenger storage.
 * This helps discover other agents who have message stores.
 *
 * @param cwd - Current working directory
 * @returns Array of agent names that have message stores
 */
export function getStoredAgents(cwd: string): string[] {
	const messengerDir = join(cwd, ".pi", "messenger");

	if (!existsSync(messengerDir)) {
		return [];
	}

	const entries = readdirSync(messengerDir, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
}
