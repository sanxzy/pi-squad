/**
 * Squad Extension - Loader Module
 *
 * Handles discovery and parsing of squad member definition files from:
 * - Project-local: <cwd>/.pi/squad/
 * - Global: ~/.pi/squad/
 *
 * Each squad member is defined in a .md file with YAML frontmatter and a system prompt body.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";

/**
 * Squad member configuration interface.
 * Represents a fully parsed and validated squad member definition.
 */
export interface SquadMemberConfig {
	/** Unique role key derived from filename, e.g. "reviewer" */
	role: string;

	/** Display name from frontmatter `name` field, or titlecased role */
	name: string;

	/** Short description for the LLM (promptSnippet) */
	description: string;

	/** System prompt (markdown body after frontmatter) */
	systemPrompt: string;

	/** Comma-separated tool list, or undefined for all tools */
	tools: string | undefined;

	/** Model ID, e.g. "anthropic/claude-sonnet-4-5", or undefined for parent model */
	model: string | undefined;

	/** Thinking level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" */
	thinking: string;

	/** Max execution timeout in ms */
	timeout: number;

	/** Additional extension paths to load in the subprocess */
	extensions: string[];

	/** Whether to disable all extensions in the subprocess */
	noExtensions: boolean;

	/** Additional environment variables */
	env: Record<string, string>;

	/** Source scope: "project" or "global" */
	scope: "project" | "global";

	/** Absolute path to the source .md file */
	sourcePath: string;
}

/**
 * Internal frontmatter structure (before normalization).
 */
interface SquadMemberFrontmatter {
	name?: string;
	description?: string;
	tools?: string;
	model?: string;
	thinking?: string;
	timeout?: number | string;
	extensions?: string;
	noExtensions?: boolean | string;
	env?: Record<string, string> | string;
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
		// No frontmatter found, treat entire content as body
		return { frontmatter: {}, body: raw };
	}

	const yamlStr = match[1]!;
	const body = match[2]!;

	// Simple YAML key-value parser (handles single-level scalars and nested objects)
	const frontmatter: SquadMemberFrontmatter = {};
	const lines = yamlStr.split("\n");

	for (const line of lines) {
		// Skip empty lines and comments
		if (!line.trim() || line.trim().startsWith("#")) continue;

		// Check for nested object (env field)
		const nestedMatch = line.match(/^(\w[\w-]*):\s*$/);
		if (nestedMatch) {
			// This is a parent key for nested content - skip for now
			// Simple parser doesn't handle multi-line nested structures
			continue;
		}

		const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
		if (kvMatch) {
			const key = kvMatch[1]! as keyof SquadMemberFrontmatter;
			let value: any = kvMatch[2]!.trim();

			// Remove quotes if present
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			// Type coercion
			else if (value === "true") value = true;
			else if (value === "false") value = false;
			else if (/^\d+$/.test(value)) value = Number(value);

			frontmatter[key] = value;
		}
	}

	return { frontmatter, body };
}

/**
 * Convert a string to title case.
 *
 * @param str - Input string (e.g., "reviewer")
 * @returns Title-cased string (e.g., "Reviewer")
 */
function titleCase(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Parse a squad member .md file into a SquadMemberConfig.
 *
 * @param role - Role identifier derived from filename
 * @param raw - Raw file content
 * @param scope - Source scope ("project" or "global")
 * @param sourcePath - Absolute path to the source file
 * @returns Parsed config or null if invalid (no body)
 */
export function parseSquadMemberFile(
	role: string,
	raw: string,
	scope: "project" | "global",
	sourcePath: string,
): SquadMemberConfig | null {
	const { frontmatter, body } = extractFrontmatter(raw);

	// Skip files with no system prompt body
	if (!body.trim()) {
		return null;
	}

	// Parse extensions field
	const extensions = frontmatter.extensions
		? String(frontmatter.extensions)
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: [];

	// Parse noExtensions field
	const noExtensions = frontmatter.noExtensions === true || frontmatter.noExtensions === "true";

	// Parse env field - handle both object and JSON string formats
	let env: Record<string, string> = {};
	if (frontmatter.env) {
		if (typeof frontmatter.env === "object" && frontmatter.env !== null) {
			env = frontmatter.env as Record<string, string>;
		} else if (typeof frontmatter.env === "string") {
			// Try to parse as JSON
			try {
				env = JSON.parse(frontmatter.env) as Record<string, string>;
			} catch {
				// If JSON parsing fails, ignore the env field
				env = {};
			}
		}
	}

	return {
		role,
		name: frontmatter.name ?? titleCase(role),
		description: frontmatter.description ?? "",
		systemPrompt: body.trim(),
		tools: frontmatter.tools ?? undefined,
		model: frontmatter.model ?? undefined,
		thinking: frontmatter.thinking ?? "off",
		timeout: Number(frontmatter.timeout) || 120_000,
		extensions,
		noExtensions,
		env,
		scope,
		sourcePath,
	};
}

/**
 * Scan a directory for squad member .md files.
 *
 * @param dir - Directory path to scan
 * @param scope - Source scope for discovered members
 * @returns Array of parsed squad member configs
 */
function scanDirectory(dir: string, scope: "project" | "global"): SquadMemberConfig[] {
	if (!existsSync(dir)) {
		return [];
	}

	const members: SquadMemberConfig[] = [];

	try {
		const entries = readdirSync(dir);

		for (const entry of entries) {
			// Only process .md files
			if (!entry.endsWith(".md")) continue;

			const filePath = join(dir, entry);
			const role = basename(entry, extname(entry)); // "reviewer.md" -> "reviewer"

			try {
				const raw = readFileSync(filePath, "utf-8");
				const config = parseSquadMemberFile(role, raw, scope, filePath);

				if (config) {
					members.push(config);
				}
			} catch (error) {
				// Skip files that can't be read
				console.warn(`[squad] Failed to read ${filePath}:`, error);
			}
		}
	} catch (error) {
		// Directory can't be read - return empty array
		console.warn(`[squad] Failed to scan directory ${dir}:`, error);
	}

	return members;
}

/**
 * Discover all squad members from both project-local and global directories.
 *
 * Project-local members take precedence over global members with the same role name.
 *
 * @param cwd - Current working directory
 * @returns Array of all discovered squad member configs
 */
export function discoverSquadMembers(cwd: string): SquadMemberConfig[] {
	const projectDir = join(cwd, ".pi", "squad");
	const globalDir = join(homedir(), ".pi", "squad");

	const projectMembers = scanDirectory(projectDir, "project");
	const globalMembers = scanDirectory(globalDir, "global");

	// Dedup: project-local wins over global for same role
	const roleMap = new Map<string, SquadMemberConfig>();

	// Add global members first
	for (const member of globalMembers) {
		roleMap.set(member.role, member);
	}

	// Override with project-local members
	for (const member of projectMembers) {
		roleMap.set(member.role, member);
	}

	return Array.from(roleMap.values());
}

/**
 * Validate a squad member configuration and return warnings.
 *
 * @param config - Squad member config to validate
 * @returns Array of warning messages
 */
export function validateSquadMember(config: SquadMemberConfig): string[] {
	const warnings: string[] = [];

	if (!config.systemPrompt) {
		warnings.push(`[${config.role}] No system prompt body — member will be skipped`);
	}

	if (config.model && !config.model.includes("/")) {
		warnings.push(`[${config.role}] Model should be in "provider/id" format: ${config.model}`);
	}

	if (config.timeout < 5000) {
		warnings.push(`[${config.role}] Timeout very low (${config.timeout}ms), minimum recommended: 5000`);
	}

	// Validate thinking level
	const validThinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh"];
	if (!validThinkingLevels.includes(config.thinking)) {
		warnings.push(
			`[${config.role}] Invalid thinking level "${config.thinking}". Valid values: ${validThinkingLevels.join(", ")}`,
		);
	}

	return warnings;
}

/**
 * Validate all squad member configs and return combined warnings.
 *
 * @param members - Array of squad member configs
 * @returns Array of all warning messages
 */
export function validateAllSquadMembers(members: SquadMemberConfig[]): string[] {
	const allWarnings: string[] = [];

	for (const member of members) {
		const warnings = validateSquadMember(member);
		allWarnings.push(...warnings);
	}

	return allWarnings;
}
