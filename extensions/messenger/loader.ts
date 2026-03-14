/**
 * Messenger Extension - Loader Module
 *
 * Handles loading agent identity and contacts from squad definition files:
 * - Project-local: <cwd>/.pi/squad/
 * - Global: ~/.pi/squad/
 *
 * Identity is loaded from the squad member files, and contacts are
 * all other squad members excluding self.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";

import type { AgentIdentity, Contact } from "./types.js";

/**
 * Frontmatter structure from squad member .md files.
 */
interface SquadMemberFrontmatter {
	name?: string;
	description?: string;
	tools?: string;
	model?: string;
}

/**
 * Extract YAML frontmatter and body from a squad member .md file.
 *
 * @param raw - Raw file content
 * @returns Parsed frontmatter object and body string
 */
function extractFrontmatter(raw: string): { frontmatter: SquadMemberFrontmatter; body: string } {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) {
		return { frontmatter: {}, body: raw };
	}

	const yamlStr = match[1]!;
	const body = match[2]!;

	const frontmatter: SquadMemberFrontmatter = {};
	const lines = yamlStr.split("\n");

	for (const line of lines) {
		// Skip empty lines and comments
		if (!line.trim() || line.trim().startsWith("#")) continue;

		const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
		if (kvMatch) {
			const key = kvMatch[1]! as keyof SquadMemberFrontmatter;
			let value = kvMatch[2]!.trim();

			// Remove quotes if present
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}

			frontmatter[key] = value;
		}
	}

	return { frontmatter, body };
}

/**
 * Parse a squad member .md file into an AgentIdentity.
 * Returns null if the file has no body (system prompt).
 *
 * @param name - Role identifier (filename without extension)
 * @param raw - Raw file content
 * @param scope - Source scope ("project" or "global")
 * @param sourcePath - Absolute path to the source file
 * @returns AgentIdentity object or null if no body
 */
function parseSquadMember(name: string, raw: string, scope: "project" | "global", sourcePath: string): AgentIdentity | null {
	const { frontmatter, body } = extractFrontmatter(raw);

	// Skip files with no system prompt body
	if (!body.trim()) {
		return null;
	}

	const displayName = frontmatter.name ?? titleCase(name);

	return {
		name,
		displayName,
		description: frontmatter.description ?? "",
		model: frontmatter.model,
		tools: frontmatter.tools,
		scope,
		sourcePath,
	};
}

/**
 * Convert a string to title case.
 *
 * @param str - Input string
 * @returns Title-cased string
 */
function titleCase(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Scan a directory for squad member .md files.
 *
 * @param dir - Directory path to scan
 * @param scope - Source scope for discovered members
 * @returns Map of name to AgentIdentity
 */
function scanDirectory(dir: string, scope: "project" | "global"): Map<string, AgentIdentity> {
	const identities = new Map<string, AgentIdentity>();

	if (!existsSync(dir)) {
		return identities;
	}

	try {
		const entries = readdirSync(dir);

		for (const entry of entries) {
			// Only process .md files
			if (!entry.endsWith(".md")) continue;

			const filePath = join(dir, entry);
			const name = basename(entry, extname(entry)); // "pixlo.md" -> "pixlo"

			try {
				const raw = readFileSync(filePath, "utf-8");
				const identity = parseSquadMember(name, raw, scope, filePath);
				// Skip files with no body (no system prompt)
				if (identity) {
					identities.set(name, identity);
				}
			} catch (error) {
				// Skip files that can't be read
				console.warn(`[messenger] Failed to read ${filePath}:`, error);
			}
		}
	} catch (error) {
		// Directory can't be read
		console.warn(`[messenger] Failed to scan directory ${dir}:`, error);
	}

	return identities;
}

/**
 * Discover all squad members from both project-local and global directories.
 * Project-local members take precedence over global members with the same name.
 *
 * @param cwd - Current working directory
 * @returns Map of name to AgentIdentity
 */
export function discoverIdentities(cwd: string): Map<string, AgentIdentity> {
	const projectDir = join(cwd, ".pi", "squad");
	const globalDir = join(homedir(), ".pi", "squad");

	const projectMembers = scanDirectory(projectDir, "project");
	const globalMembers = scanDirectory(globalDir, "global");

	// Add global members first
	const allMembers = new Map(globalMembers);

	// Override with project-local members
	for (const [name, identity] of projectMembers) {
		allMembers.set(name, identity);
	}

	return allMembers;
}

/**
 * Get the current agent's identity based on the agent name provided.
 * This is called during extension initialization with the agent's name.
 *
 * @param cwd - Current working directory
 * @param agentName - The agent's name (role)
 * @returns AgentIdentity or null if not found
 */
export function getMyIdentity(cwd: string, agentName: string): AgentIdentity | null {
	const identities = discoverIdentities(cwd);
	return identities.get(agentName) ?? null;
}

/**
 * Get all contacts (other squad members excluding self).
 *
 * @param cwd - Current working directory
 * @param excludeName - Name to exclude (self)
 * @returns Array of Contact objects
 */
export function getContacts(cwd: string, excludeName: string): Contact[] {
	const identities = discoverIdentities(cwd);

	const contacts: Contact[] = [];
	for (const [name, identity] of identities) {
		if (name === excludeName) continue;

		contacts.push({
			name: identity.name,
			displayName: identity.displayName,
			description: identity.description,
			model: identity.model,
			tools: identity.tools,
			scope: identity.scope,
		});
	}

	// Sort by display name
	return contacts.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Get a specific contact by name.
 *
 * @param cwd - Current working directory
 * @param contactName - Contact's name to find
 * @returns Contact or null if not found
 */
export function getContact(cwd: string, contactName: string): Contact | null {
	const identities = discoverIdentities(cwd);
	const identity = identities.get(contactName);

	if (!identity) return null;

	return {
		name: identity.name,
		displayName: identity.displayName,
		description: identity.description,
		model: identity.model,
		tools: identity.tools,
		scope: identity.scope,
	};
}

/**
 * Validate that a contact exists.
 *
 * @param cwd - Current working directory
 * @param contactName - Contact name to validate
 * @returns true if contact exists
 */
export function contactExists(cwd: string, contactName: string): boolean {
	const identities = discoverIdentities(cwd);
	return identities.has(contactName);
}

/**
 * Get all known agent names (from squad definitions).
 *
 * @param cwd - Current working directory
 * @returns Array of agent names
 */
export function getAllAgentNames(cwd: string): string[] {
	const identities = discoverIdentities(cwd);
	return Array.from(identities.keys());
}
