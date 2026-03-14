/**
 * Messenger Extension - Type Definitions
 *
 * Core data structures for the WhatsApp-style messaging system.
 * Each agent has their own "personal phone" (message store).
 */

import type { Static, TEnum, TUnion } from "@sinclair/typebox";

/**
 * Message status indicating read/unread state.
 */
export type MessageStatus = "unread" | "read";

/**
 * Direction of the message (incoming or outgoing).
 */
export type MessageDirection = "incoming" | "outgoing";

/**
 * Core message structure stored in JSONL format.
 */
export interface Message {
	/** Unique message ID (format: msg_<timestamp>_<random>) */
	id: string;

	/** Sender identity (the agent who sent this message) */
	from: string;

	/** Recipient identity (the agent who should receive this message) */
	to: string;

	/** Message content/text */
	content: string;

	/** ISO timestamp when message was sent */
	timestamp: string;

	/** Message status: unread or read */
	status: MessageStatus;

	/** Direction: incoming (received) or outgoing (sent by me) */
	direction: MessageDirection;

	/** ID of the message being replied to (optional, for threading) */
	replyTo?: string;
}

/**
 * Agent identity configuration loaded from .pi/squad/<name>.md files.
 */
export interface AgentIdentity {
	/** Unique role/name identifier (derived from filename) */
	name: string;

	/** Display name from frontmatter */
	displayName: string;

	/** Short description from frontmatter */
	description: string;

	/** Model ID if specified */
	model?: string;

	/** Tools available to this agent */
	tools?: string;

	/** Source scope: "project" or "global" */
	scope: "project" | "global";

	/** Absolute path to the source .md file */
	sourcePath: string;
}

/**
 * Contact information for another agent.
 */
export interface Contact {
	/** Contact's unique name/role */
	name: string;

	/** Contact's display name */
	displayName: string;

	/** Short description */
	description: string;

	/** Model ID if specified */
	model?: string;

	/** Tools available to this contact */
	tools?: string;

	/** Source scope */
	scope: "project" | "global";
}

/**
 * Result of checking for unread messages.
 */
export interface UnreadCheckResult {
	/** Whether there are any unread messages */
	hasUnread: boolean;

	/** Map of contact name to unread count */
	unreadCounts: Map<string, number>;

	/** Total unread count */
	totalUnread: number;
}

/**
 * Chat conversation between two agents.
 */
export interface Conversation {
	/** The other participant in this conversation */
	contact: string;

	/** All messages in the conversation (sorted by timestamp, oldest first) */
	messages: Message[];

	/** Count of unread messages in this conversation */
	unreadCount: number;

	/** Last message timestamp */
	lastMessageAt?: string;
}

/**
 * Tool action types for the messenger tool.
 */
export type MessengerAction =
	| "get_my_identity"
	| "get_list_contacts"
	| "check_unread"
	| "read_messages"
	| "send_message"
	| "reply_to_message"
	| "search_messages";

/**
 * Parameters for get_my_identity action.
 */
export interface GetMyIdentityParams {
	action: "get_my_identity";
}

/**
 * Parameters for get_list_contacts action.
 */
export interface GetListContactsParams {
	action: "get_list_contacts";
}

/**
 * Parameters for check_unread action.
 */
export interface CheckUnreadParams {
	action: "check_unread";
}

/**
 * Parameters for read_messages action.
 */
export interface ReadMessagesParams {
	action: "read_messages";
	/** Contact name to read messages from */
	contact: string;
}

/**
 * Parameters for send_message action.
 */
export interface SendMessageParams {
	action: "send_message";
	/** Recipient contact name */
	to: string;
	/** Message content */
	message: string;
}

/**
 * Parameters for reply_to_message action.
 */
export interface ReplyToMessageParams {
	action: "reply_to_message";
	/** Recipient contact name */
	to: string;
	/** Message content */
	message: string;
	/** ID of the message to reply to */
	replyTo: string;
}

/**
 * Parameters for search_messages action.
 */
export interface SearchMessagesParams {
	action: "search_messages";
	/** Search query string */
	query: string;
	/** Maximum number of results (optional, default: 50) */
	limit?: number;
}

/**
 * Union of all messenger action parameters.
 */
export type MessengerParams =
	| GetMyIdentityParams
	| GetListContactsParams
	| CheckUnreadParams
	| ReadMessagesParams
	| SendMessageParams
	| ReplyToMessageParams
	| SearchMessagesParams;

/**
 * Typebox schema for MessengerAction enum.
 * Used for tool parameter validation.
 */
export const MessengerActionSchema = {
	"get_my_identity": "get_my_identity",
	"get_list_contacts": "get_list_contacts",
	"check_unread": "check_unread",
	"read_messages": "read_messages",
	"send_message": "send_message",
	"reply_to_message": "reply_to_message",
	"search_messages": "search_messages",
} as const;

/**
 * Result details included in tool responses for rendering.
 */
export interface MessengerToolDetails {
	action: MessengerAction;
	identity?: AgentIdentity;
	contacts?: Contact[];
	hasUnread?: boolean;
	unreadCounts?: Array<{ contact: string; count: number }>;
	conversation?: {
		contact: string;
		messageCount: number;
		unreadCount: number;
	};
	messageSent?: {
		to: string;
		messageId: string;
		timestamp: string;
	};
	searchResults?: {
		query: string;
		count: number;
		matches: Array<{
			id: string;
			from: string;
			to: string;
			content: string;
			timestamp: string;
		}>;
	};
	error?: string;
}

/**
 * Extension state for the messenger.
 */
export interface MessengerState {
	/** Current agent's identity */
	identity: AgentIdentity | null;

	/** All available contacts (other squad members) */
	contacts: Contact[];

	/** Current working directory */
	cwd: string;

	/** Whether the extension has been initialized */
	initialized: boolean;
}

/**
 * Storage file paths configuration.
 */
export interface StoragePaths {
	/** Directory for messenger storage */
	messengerDir: string;

	/** Directory for this agent's messages */
	agentDir: string;

	/** Path to messages.jsonl file */
	messagesFile: string;
}
