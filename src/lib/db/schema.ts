import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Users table
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  role: text("role", { enum: ["primary_planner", "copilot"] }).notNull(),
  partnerId: text("partner_id"), // Self-reference handled at app level
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Children table (for age-based AI suggestions)
export const children = sqliteTable("children", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  birthDate: text("birth_date").notNull(), // ISO date string
  userId: text("user_id").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Brain dumps from primary planner
export const brainDumps = sqliteTable("brain_dumps", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  type: text("type", { enum: ["text", "voice"] }).notNull().default("text"),
  voiceUrl: text("voice_url"), // If voice note, URL to audio file
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Daily digests generated for copilot parent
export const digests = sqliteTable("digests", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id), // The copilot receiving this
  date: text("date").notNull(), // ISO date string (YYYY-MM-DD)
  recentMentions: text("recent_mentions").notNull(), // JSON string
  considerThisWeek: text("consider_this_week").notNull(), // JSON string
  comingUpSoon: text("coming_up_soon").notNull(), // JSON string
  viewedAt: integer("viewed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Track which digest items led to conversations (success metric)
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  digestId: text("digest_id").references(() => digests.id),
  topic: text("topic").notNull(),
  hadConversation: integer("had_conversation", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Types for TypeScript
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type BrainDump = typeof brainDumps.$inferSelect;
export type NewBrainDump = typeof brainDumps.$inferInsert;
export type Digest = typeof digests.$inferSelect;
export type Child = typeof children.$inferSelect;
