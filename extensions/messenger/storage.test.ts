/**
 * Messenger Extension - Storage Module Tests
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	appendMessage,
	generateMessageId,
	getStoragePaths,
	readAllMessages,
	readConversation,
	getUnreadCount,
	markConversationAsRead,
	sendMessage,
} from "./storage.js";
import type { Message } from "./types.js";

describe("Storage Module", () => {
	let testDir: string;

	beforeEach(() => {
		// Create a temporary directory for each test
		testDir = mkdtempSync(join(tmpdir(), "messenger-test-"));
	});

	afterEach(() => {
		// Clean up the temporary directory after each test
		rmSync(testDir, { recursive: true, force: true });
	});

	describe("generateMessageId", () => {
		it("should generate unique message IDs", () => {
			const id1 = generateMessageId();
			const id2 = generateMessageId();

			assert.notStrictEqual(id1, id2);
			assert.match(id1, /^msg_\d+_[a-z0-9]+$/);
		});
	});

	describe("getStoragePaths", () => {
		it("should return correct storage paths", () => {
			const paths = getStoragePaths(testDir, "pixlo");

			assert.strictEqual(paths.messengerDir, join(testDir, ".pi", "messenger"));
			assert.strictEqual(paths.agentDir, join(testDir, ".pi", "messenger", "pixlo"));
			assert.strictEqual(paths.messagesFile, join(testDir, ".pi", "messenger", "pixlo", "messages.jsonl"));
		});
	});

	describe("appendMessage", () => {
		it("should create storage directory if it doesn't exist", () => {
			const paths = getStoragePaths(testDir, "pixlo");
			const message: Message = {
				id: "msg_123",
				from: "pixlo",
				to: "finder",
				content: "Hello finder!",
				timestamp: new Date().toISOString(),
				status: "unread",
				direction: "outgoing",
			};

			appendMessage(paths, message);

			// Directory should be created
			assert.strictEqual(existsSync(paths.agentDir), true);
		});

		it("should append message to file", () => {
			const paths = getStoragePaths(testDir, "pixlo");
			const message: Message = {
				id: "msg_123",
				from: "pixlo",
				to: "finder",
				content: "Hello finder!",
				timestamp: new Date().toISOString(),
				status: "unread",
				direction: "outgoing",
			};

			appendMessage(paths, message);
			const messages = readAllMessages(paths);

			assert.strictEqual(messages.length, 1);
			assert.strictEqual(messages[0]!.id, "msg_123");
			assert.strictEqual(messages[0]!.content, "Hello finder!");
		});

		it("should append multiple messages", () => {
			const paths = getStoragePaths(testDir, "pixlo");

			for (let i = 0; i < 3; i++) {
				appendMessage(paths, {
					id: `msg_${i}`,
					from: "pixlo",
					to: "finder",
					content: `Message ${i}`,
					timestamp: new Date().toISOString(),
					status: "unread",
					direction: "outgoing",
				});
			}

			const messages = readAllMessages(paths);
			assert.strictEqual(messages.length, 3);
		});
	});

	describe("readAllMessages", () => {
		it("should return empty array for non-existent file", () => {
			const paths = getStoragePaths(testDir, "nonexistent");
			const messages = readAllMessages(paths);
			assert.strictEqual(messages.length, 0);
		});

		it("should return messages sorted by timestamp", () => {
			const paths = getStoragePaths(testDir, "pixlo");

			// Add messages with different timestamps (in chronological order)
			const times = [
				new Date("2024-01-01T09:00:00.000Z").toISOString(),
				new Date("2024-01-01T10:00:00.000Z").toISOString(),
				new Date("2024-01-01T11:00:00.000Z").toISOString(),
			];

			// Add in random order
			[times[1]!, times[0]!, times[2]!].forEach((time, i) => {
				appendMessage(paths, {
					id: `msg_${i}`,
					from: "pixlo",
					to: "finder",
					content: `Message ${i}`,
					timestamp: time,
					status: "unread",
					direction: "outgoing",
				});
			});

			const messages = readAllMessages(paths);
			assert.strictEqual(messages.length, 3);
			// Should be sorted oldest first - verify by comparing timestamps as dates
			const t0 = new Date(messages[0]!.timestamp).getTime();
			const t1 = new Date(messages[1]!.timestamp).getTime();
			const t2 = new Date(messages[2]!.timestamp).getTime();

			assert.ok(t0 <= t1);
			assert.ok(t1 <= t2);
		});

		it("should skip malformed JSON lines", () => {
			const paths = getStoragePaths(testDir, "pixlo");

			// Ensure directory exists first
			mkdirSync(paths.agentDir, { recursive: true });

			// Write some valid and invalid lines
			writeFileSync(paths.messagesFile, `
{"id": "msg_1", "from": "pixlo", "to": "finder", "content": "Valid", "timestamp": "2024-01-01T10:00:00Z", "status": "unread", "direction": "outgoing"}
invalid json here
{"id": "msg_2", "from": "pixlo", "to": "finder", "content": "Also valid", "timestamp": "2024-01-01T11:00:00Z", "status": "unread", "direction": "outgoing"}
			`.trim());

			const messages = readAllMessages(paths);
			assert.strictEqual(messages.length, 2);
		});
	});

	describe("readConversation", () => {
		it("should filter messages for specific contact", () => {
			const paths = getStoragePaths(testDir, "pixlo");

			// Add messages to different contacts
			appendMessage(paths, {
				id: "msg_1",
				from: "pixlo",
				to: "finder",
				content: "To finder",
				timestamp: new Date().toISOString(),
				status: "unread",
				direction: "outgoing",
			});

			appendMessage(paths, {
				id: "msg_2",
				from: "pixlo",
				to: "critic",
				content: "To critic",
				timestamp: new Date().toISOString(),
				status: "unread",
				direction: "outgoing",
			});

			const finderMessages = readConversation(paths, "pixlo", "finder");
			assert.strictEqual(finderMessages.length, 1);
			assert.strictEqual(finderMessages[0]!.to, "finder");

			const criticMessages = readConversation(paths, "pixlo", "critic");
			assert.strictEqual(criticMessages.length, 1);
			assert.strictEqual(criticMessages[0]!.to, "critic");
		});

		it("should include incoming messages from contact", () => {
			const paths = getStoragePaths(testDir, "pixlo");

			// Add incoming message from finder
			appendMessage(paths, {
				id: "msg_1",
				from: "finder",
				to: "pixlo",
				content: "From finder",
				timestamp: new Date().toISOString(),
				status: "unread",
				direction: "incoming",
			});

			const finderMessages = readConversation(paths, "pixlo", "finder");
			assert.strictEqual(finderMessages.length, 1);
			assert.strictEqual(finderMessages[0]!.from, "finder");
		});
	});

	describe("getUnreadCount", () => {
		it("should return 0 for no messages", () => {
			const paths = getStoragePaths(testDir, "pixlo");
			const count = getUnreadCount(paths, "pixlo", "finder");
			assert.strictEqual(count, 0);
		});

		it("should count only incoming unread messages", () => {
			const paths = getStoragePaths(testDir, "pixlo");

			// Add unread incoming message
			appendMessage(paths, {
				id: "msg_1",
				from: "finder",
				to: "pixlo",
				content: "Unread",
				timestamp: new Date().toISOString(),
				status: "unread",
				direction: "incoming",
			});

			// Add read incoming message
			appendMessage(paths, {
				id: "msg_2",
				from: "finder",
				to: "pixlo",
				content: "Read",
				timestamp: new Date().toISOString(),
				status: "read",
				direction: "incoming",
			});

			// Add outgoing message (shouldn't count)
			appendMessage(paths, {
				id: "msg_3",
				from: "pixlo",
				to: "finder",
				content: "Outgoing",
				timestamp: new Date().toISOString(),
				status: "unread",
				direction: "outgoing",
			});

			const count = getUnreadCount(paths, "pixlo", "finder");
			assert.strictEqual(count, 1);
		});
	});

	describe("markConversationAsRead", () => {
		it("should mark incoming messages as read", () => {
			const paths = getStoragePaths(testDir, "pixlo");

			appendMessage(paths, {
				id: "msg_1",
				from: "finder",
				to: "pixlo",
				content: "Unread 1",
				timestamp: new Date().toISOString(),
				status: "unread",
				direction: "incoming",
			});

			appendMessage(paths, {
				id: "msg_2",
				from: "finder",
				to: "pixlo",
				content: "Unread 2",
				timestamp: new Date().toISOString(),
				status: "unread",
				direction: "incoming",
			});

			const marked = markConversationAsRead(paths, "pixlo", "finder");
			assert.strictEqual(marked, 2);

			const count = getUnreadCount(paths, "pixlo", "finder");
			assert.strictEqual(count, 0);
		});

		it("should not affect other contacts", () => {
			const paths = getStoragePaths(testDir, "pixlo");

			appendMessage(paths, {
				id: "msg_1",
				from: "finder",
				to: "pixlo",
				content: "From finder",
				timestamp: new Date().toISOString(),
				status: "unread",
				direction: "incoming",
			});

			appendMessage(paths, {
				id: "msg_2",
				from: "critic",
				to: "pixlo",
				content: "From critic",
				timestamp: new Date().toISOString(),
				status: "unread",
				direction: "incoming",
			});

			markConversationAsRead(paths, "pixlo", "finder");

			const finderCount = getUnreadCount(paths, "pixlo", "finder");
			const criticCount = getUnreadCount(paths, "pixlo", "critic");

			assert.strictEqual(finderCount, 0);
			assert.strictEqual(criticCount, 1);
		});
	});

	describe("sendMessage", () => {
		it("should create message in both sender and receiver stores", () => {
			const senderPaths = getStoragePaths(testDir, "pixlo");
			const receiverPaths = getStoragePaths(testDir, "finder");

			const message = sendMessage(testDir, "pixlo", "finder", "Hello finder!");

			// Check sender's outbox
			const senderMessages = readAllMessages(senderPaths);
			assert.strictEqual(senderMessages.length, 1);
			assert.strictEqual(senderMessages[0]!.direction, "outgoing");

			// Check receiver's inbox
			const receiverMessages = readAllMessages(receiverPaths);
			assert.strictEqual(receiverMessages.length, 1);
			assert.strictEqual(receiverMessages[0]!.direction, "incoming");
			assert.strictEqual(receiverMessages[0]!.content, "Hello finder!");
		});

		it("should include replyTo when provided", () => {
			const message = sendMessage(testDir, "pixlo", "finder", "Thanks!", "msg_123");

			const paths = getStoragePaths(testDir, "pixlo");
			const messages = readAllMessages(paths);

			assert.strictEqual(messages[0]!.replyTo, "msg_123");
		});
	});
});
