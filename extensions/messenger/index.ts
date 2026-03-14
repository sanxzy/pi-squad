/**
 * Messenger Extension - Main Entry Point
 *
 * WhatsApp-style messaging system for agent collaboration.
 * Each agent has their own "personal phone" (message store).
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import {
	contactExists,
	getContacts,
	getMyIdentity,
} from "./loader.js";
import {
	getStoragePaths,
	getUnreadCount,
	markConversationAsRead,
	readConversation,
	sendMessage as storeMessage,
	searchMessages,
} from "./storage.js";
import type { AgentIdentity, Contact, MessengerToolDetails } from "./types.js";

/**
 * Extension state - persists across session events.
 */
interface MessengerExtensionState {
	/** Current agent's identity (set via get_my_identity) */
	identity: AgentIdentity | null;

	/** Cached contacts list */
	contacts: Contact[];

	/** Current working directory */
	cwd: string;

	/** Whether the extension has been initialized */
	initialized: boolean;
}

const state: MessengerExtensionState = {
	identity: null,
	contacts: [],
	cwd: "",
	initialized: false,
};

/**
 * Initialize the extension state for a session.
 */
function initializeState(ctx: ExtensionContext): void {
	state.cwd = ctx.cwd;
	state.initialized = true;
}

/**
 * Ensure identity is set before proceeding.
 */
function ensureIdentity(): void {
	if (!state.identity) {
		throw new Error(
			"Identity not set. Call get_my_identity first with your agent name.\n" +
				"Example: messenger({ action: 'get_my_identity', name: 'pixlo' })",
		);
	}
}

/**
 * Format a message for display.
 */
function formatMessage(message: {
	from: string;
	to: string;
	content: string;
	timestamp: string;
	direction: "incoming" | "outgoing";
	replyTo?: string;
}): string {
	const direction = message.direction === "outgoing" ? "→" : "←";
	const time = new Date(message.timestamp).toLocaleTimeString();
	const reply = message.replyTo ? ` (reply to ${message.replyTo})` : "";
	return `${direction} ${message.from} → ${message.to} [${time}]${reply}\n  ${message.content}`;
}

/**
 * Main extension function - registers tools and handlers with the pi API.
 */
export default function MessengerExtension(pi: ExtensionAPI): void {
	// Session start - initialize state
	pi.on("session_start", async (_event, ctx) => {
		initializeState(ctx);

		// Set status in UI
		if (ctx.hasUI) {
			ctx.ui.setStatus("messenger", "📱 Messenger ready");
		}
	});

	// Session switch - reset state
	pi.on("session_switch", async (_event, ctx) => {
		// Keep identity but update cwd
		state.cwd = ctx.cwd;
	});

	// Session shutdown - cleanup
	pi.on("session_shutdown", async () => {
		state.identity = null;
		state.contacts = [];
		state.cwd = "";
		state.initialized = false;
	});

	// Before agent starts - inject messaging system prompt
// 	pi.on("before_agent_start", async (_event, _ctx) => {
// 		// Only inject if identity is set
// 		if (!state.identity) {
// 			return {
// 				systemPrompt: undefined,
// 			};
// 		}

// 		const contactList = state.contacts
// 			.map((c) => `  - ${c.displayName} (${c.name}): ${c.description || "No description"}`)
// 			.join("\n");

// 		return {
// 			systemPrompt: `
// ## Messaging System

// You have access to a messaging system to communicate with other squad members.

// ### Your Identity
// - **Name**: ${state.identity.displayName} (${state.identity.name})
// - **Description**: ${state.identity.description || "None"}

// ### Available Contacts
// ${contactList || "  No other contacts available"}

// ### How to Use Messaging
// 1. **At START of each task**: Check for unread messages using:
//    \`\`\`
//    messenger({ action: "check_unread" })
//    \`\`\`

// 2. **If you have unread messages**: Read them with:
//    \`\`\`
//    messenger({ action: "read_messages", contact: "<name>" })
//    \`\`\`

// 3. **Send messages** to other agents:
//    \`\`\`
//    messenger({ action: "send_message", to: "<name>", message: "Your message here" })
//    \`\`\`

// 4. **Reply to specific messages**:
//    \`\`\`
//    messenger({ action: "reply_to_message", to: "<name>", message: "Reply content", replyTo: "<message_id>" })
//    \`\`\`

// ### Important Rules
// - **Check for messages at the START of every task**
// - Messages are persistent - conversation history is saved
// - Use clear, actionable messages
// - Include relevant context when requesting help from other agents
// `,
// 		};
// 	});

	// Register the messenger tool
	pi.registerTool({
		name: "messenger",
		label: "Messenger",
		description:
			"WhatsApp-style messaging between squad members. Get identity, list contacts, check messages, send messages, and reply to messages.",
		promptSnippet: "Communicate with other squad agents via direct messages",
		promptGuidelines: [
			"Use messenger to communicate with other squad members.",
			"Always call get_my_identity first to set your identity.",
			"Use check_unread to see if you have new messages.",
			"Use read_messages to view a conversation.",
			"Use send_message to send a direct message to another agent.",
			"Use reply_to_message to reply to a specific message.",
			"Messages are persistent - conversation history is saved.",
		],
		parameters: Type.Object({
			action: StringEnum([
				"get_my_identity",
				"get_list_contacts",
				"check_unread",
				"read_messages",
				"send_message",
				"reply_to_message",
				"search_messages",
			] as const),
			/** Agent's own name (required for get_my_identity) */
			name: Type.Optional(Type.String({ description: "Your agent name (for get_my_identity action)" })),
			/** Contact name (for read_messages, send_message, reply_to_message) */
			contact: Type.Optional(Type.String({ description: "Contact name to interact with" })),
			/** Message content (for send_message, reply_to_message) */
			message: Type.Optional(Type.String({ description: "Message content to send" })),
			/** Message ID to reply to (for reply_to_message) */
			replyTo: Type.Optional(Type.String({ description: "Message ID to reply to" })),
			/** Search query (for search_messages) */
			query: Type.Optional(Type.String({ description: "Search query string" })),
			/** Search limit (for search_messages, default: 50) */
			limit: Type.Optional(Type.Number({ description: "Maximum number of search results" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { action, name, contact, message, replyTo, query, limit } = params;

			try {
				switch (action) {
					case "get_my_identity": {
						// Get the agent's name - either from parameter or stored
						const agentName = name;
						if (!agentName) {
							// If already have identity, return it
							if (state.identity) {
								return {
									content: [
										{
											type: "text",
											text: `Your identity: ${state.identity.displayName} (${state.identity.name})\n${state.identity.description}`,
										},
									],
									details: {
										action: "get_my_identity",
										identity: state.identity,
									} as MessengerToolDetails,
								};
							}
							throw new Error("Name parameter required. Provide your agent name (e.g., 'pixlo', 'finder', 'critic')");
						}

						// Load identity from squad files
						const identity = getMyIdentity(state.cwd, agentName);
						if (!identity) {
							throw new Error(
								`Identity '${agentName}' not found in squad members. ` +
									"Make sure you have a .pi/squad/<name>.md file.",
							);
						}

						// Store identity and load contacts
						state.identity = identity;
						state.contacts = getContacts(state.cwd, agentName);

						return {
							content: [
								{
									type: "text",
									text: `Identity set to: ${identity.displayName} (${identity.name})\n` +
										`Description: ${identity.description || "None"}\n` +
										`Contacts available: ${state.contacts.length}`,
								},
							],
							details: {
								action: "get_my_identity",
								identity,
							} as MessengerToolDetails,
						};
					}

					case "get_list_contacts": {
						ensureIdentity();

						if (state.contacts.length === 0) {
							return {
								content: [{ type: "text", text: "No contacts found. Other squad members will appear here." }],
								details: {
									action: "get_list_contacts",
									contacts: [],
								} as MessengerToolDetails,
							};
						}

						const lines = ["Available contacts:"];
						for (const c of state.contacts) {
							const unread = getUnreadCount(
								getStoragePaths(state.cwd, state.identity!.name),
								state.identity!.name,
								c.name,
							);
							const unreadBadge = unread > 0 ? ` [${unread} unread]` : "";
							lines.push(`  • ${c.displayName} (${c.name})${unreadBadge}`);
							if (c.description) lines.push(`    ${c.description}`);
						}

						return {
							content: [{ type: "text", text: lines.join("\n") }],
							details: {
								action: "get_list_contacts",
								contacts: state.contacts,
							} as MessengerToolDetails,
						};
					}

					case "check_unread": {
						ensureIdentity();
						const identity = state.identity!;

						const paths = getStoragePaths(state.cwd, identity.name);
						let totalUnread = 0;
						const unreadCounts: Array<{ contact: string; count: number }> = [];

						for (const c of state.contacts) {
							const count = getUnreadCount(paths, identity.name, c.name);
							if (count > 0) {
								unreadCounts.push({ contact: c.name, count });
								totalUnread += count;
							}
						}

						if (totalUnread === 0) {
							return {
								content: [{ type: "text", text: "No unread messages." }],
								details: {
									action: "check_unread",
									hasUnread: false,
									unreadCounts: [],
								} as MessengerToolDetails,
							};
						}

						const lines = [`You have ${totalUnread} unread message(s):`];
						for (const uc of unreadCounts) {
							lines.push(`  • ${uc.contact}: ${uc.count} unread`);
						}

						return {
							content: [{ type: "text", text: lines.join("\n") }],
							details: {
								action: "check_unread",
								hasUnread: true,
								unreadCounts,
							} as MessengerToolDetails,
						};
					}

					case "read_messages": {
						ensureIdentity();

						if (!contact) {
							throw new Error("Contact parameter required. Specify which contact's messages to read.");
						}

						// Verify contact exists
						if (!contactExists(state.cwd, contact)) {
							throw new Error(`Contact '${contact}' not found. Use get_list_contacts to see available contacts.`);
						}

						const paths = getStoragePaths(state.cwd, state.identity!.name);
						const messages = readConversation(paths, state.identity!.name, contact);

						if (messages.length === 0) {
							return {
								content: [{ type: "text", text: `No messages with ${contact} yet.` }],
								details: {
									action: "read_messages",
									conversation: { contact, messageCount: 0, unreadCount: 0 },
								} as MessengerToolDetails,
							};
						}

						// Mark messages as read
						markConversationAsRead(paths, state.identity!.name, contact);

						// Format messages
						const lines = [`Conversation with ${contact} (${messages.length} messages):\n`];
						for (const msg of messages) {
							lines.push(formatMessage(msg));
							lines.push("");
						}

						const unreadCount = messages.filter(
							(m) => m.from === contact && m.status === "unread",
						).length;

						return {
							content: [{ type: "text", text: lines.join("\n") }],
							details: {
								action: "read_messages",
								conversation: {
									contact,
									messageCount: messages.length,
									unreadCount,
								},
							} as MessengerToolDetails,
						};
					}

					case "send_message": {
						ensureIdentity();

						if (!contact) {
							throw new Error("Contact parameter required. Specify who to send the message to.");
						}
						if (!message) {
							throw new Error("Message parameter required. Specify the message content.");
						}

						// Verify contact exists
						if (!contactExists(state.cwd, contact)) {
							throw new Error(`Contact '${contact}' not found. Use get_list_contacts to see available contacts.`);
						}

						// Can't send message to self
						if (contact === state.identity!.name) {
							throw new Error("Cannot send message to yourself.");
						}

						const msg = storeMessage(state.cwd, state.identity!.name, contact, message);

						return {
							content: [
								{
									type: "text",
									text: `Message sent to ${contact}:\n  ${message}\n` +
										`(Message ID: ${msg.id})`,
								},
							],
							details: {
								action: "send_message",
								messageSent: {
									to: contact,
									messageId: msg.id,
									timestamp: msg.timestamp,
								},
							} as MessengerToolDetails,
						};
					}

					case "reply_to_message": {
						ensureIdentity();

						if (!message) {
							throw new Error("Message parameter required. Specify the reply content.");
						}
						if (!replyTo) {
							throw new Error("replyTo parameter required. Specify the message ID to reply to.");
						}

						// Auto-detect contact if not provided - find from the message being replied to
						let targetContact = contact;
						if (!targetContact) {
							// Search through all contacts to find the message
							for (const c of state.contacts) {
								const paths = getStoragePaths(state.cwd, state.identity!.name);
								const convMessages = readConversation(paths, state.identity!.name, c.name);
								const found = convMessages.find((m) => m.id === replyTo);
								if (found) {
									targetContact = c.name;
									break;
								}
							}
						}

						if (!targetContact) {
							throw new Error("Contact parameter required. Could not auto-detect from message ID. Please specify the contact to reply to.");
						}

						// Verify contact exists
						if (!contactExists(state.cwd, targetContact)) {
							throw new Error(`Contact '${targetContact}' not found. Use get_list_contacts to see available contacts.`);
						}

						// Get the conversation to verify the message exists
						const paths = getStoragePaths(state.cwd, state.identity!.name);
						const messages = readConversation(paths, state.identity!.name, targetContact);

						// Check if the message being replied to exists
						const parentMessage = messages.find((m) => m.id === replyTo);
						// If parent message not found (e.g., cross-session messaging), still allow sending but without reply reference
						const actualReplyTo = parentMessage ? replyTo : undefined;

						const msg = storeMessage(state.cwd, state.identity!.name, targetContact, message, actualReplyTo);

						const resultText = actualReplyTo
							? `Replied to ${targetContact} (${replyTo}):\n  ${message}\n(Message ID: ${msg.id})`
							: `Replied to ${targetContact}:\n  ${message}\n(Message ID: ${msg.id}) [Note: Original message not found in local storage]`;

						return {
							content: [
								{
									type: "text",
									text: resultText,
								},
							],
							details: {
								action: "reply_to_message",
								messageSent: {
									to: targetContact,
									messageId: msg.id,
									timestamp: msg.timestamp,
								},
							} as MessengerToolDetails,
						};
					}

					case "search_messages": {
						ensureIdentity();

						const query = params.query;
						if (!query) {
							throw new Error("Query parameter required. Specify what to search for.");
						}

						const limit = params.limit ?? 50;
						const paths = getStoragePaths(state.cwd, state.identity!.name);
						const results = searchMessages(paths, state.identity!.name, query, limit);

						if (results.length === 0) {
							return {
								content: [{ type: "text", text: `No messages found matching "${query}".` }],
								details: {
									action: "search_messages",
									searchResults: { query, count: 0, matches: [] },
								} as MessengerToolDetails,
							};
						}

						const lines = [`Found ${results.length} message(s) matching "${query}":\n`];
						for (const msg of results) {
							lines.push(formatMessage(msg));
							lines.push("");
						}

						return {
							content: [{ type: "text", text: lines.join("\n") }],
							details: {
								action: "search_messages",
								searchResults: {
									query,
									count: results.length,
									matches: results.map((m) => ({
										id: m.id,
										from: m.from,
										to: m.to,
										content: m.content,
										timestamp: m.timestamp,
									})),
								},
							} as MessengerToolDetails,
						};
					}

					default:
						throw new Error(`Unknown action: ${action}`);
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Error: ${errorMessage}` }],
					details: {
						action: action,
						error: errorMessage,
					} as MessengerToolDetails,
				};
			}
		},
		// Render function for tool calls
		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("messenger ")) + theme.fg("accent", args.action);
			if (args.name) text += ` ${theme.fg("muted", args.name)}`;
			if (args.contact) text += ` ${theme.fg("muted", args.contact)}`;
			if (args.message) {
				const preview = args.message.length > 50 ? `${args.message.slice(0, 47)}...` : args.message;
				text += `\n${theme.fg("dim", `  "${preview}"`)}`;
			}
			return new Text(text, 0, 0);
		},
		// Render function for tool results
		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as MessengerToolDetails | undefined;

			if (isPartial) {
				return new Text(theme.fg("accent", "● ") + theme.fg("dim", "Processing..."), 0, 0);
			}

			// Handle errors
			if (details?.error) {
				return new Text(theme.fg("error", `✗ ${details.error}`), 0, 0);
			}

			// Handle different actions
			if (details?.action === "get_my_identity") {
				if (details.identity) {
					return new Text(
						theme.fg("success", "✓ ") +
							theme.fg("accent", details.identity.displayName) +
							theme.fg("dim", ` (${details.identity.name})`),
						0,
						0,
					);
				}
				return new Text(theme.fg("dim", "Identity not set"), 0, 0);
			}

			if (details?.action === "get_list_contacts") {
				const count = details.contacts?.length ?? 0;
				return new Text(theme.fg("success", `${count} contact(s)`), 0, 0);
			}

			if (details?.action === "check_unread") {
				if (details.hasUnread) {
					const total = details.unreadCounts?.reduce((sum, uc) => sum + uc.count, 0) ?? 0;
					return new Text(theme.fg("warning", `${total} unread message(s)`), 0, 0);
				}
				return new Text(theme.fg("dim", "No unread messages"), 0, 0);
			}

			if (details?.action === "read_messages") {
				if (details.conversation) {
					const { contact, messageCount } = details.conversation;
					return new Text(
						theme.fg("success", `${messageCount} message(s) with ${contact}`),
						0,
						0,
					);
				}
			}

			if (details?.action === "send_message" || details?.action === "reply_to_message") {
				if (details.messageSent) {
					return new Text(
						theme.fg("success", "✓ ") +
							theme.fg("dim", `Sent to ${details.messageSent.to}`),
						0,
						0,
					);
				}
			}

			if (details?.action === "search_messages") {
				if (details.searchResults) {
					const { query: searchQuery, count } = details.searchResults;
					return new Text(
						theme.fg("success", `${count} result(s)`) +
							theme.fg("dim", ` for "${searchQuery}"`),
						0,
						0,
					);
				}
			}

			// Default: show first line of content
			const content = result.content[0];
			if (content?.type === "text") {
				const preview = content.text.split("\n")[0] || "";
				const text = preview.length > 80 ? `${preview.slice(0, 77)}...` : preview;
				return new Text(theme.fg("dim", text), 0, 0);
			}

			return new Text(theme.fg("dim", "No output"), 0, 0);
		},
	});
}
