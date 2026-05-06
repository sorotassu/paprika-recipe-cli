/**
 * Regression tests for shared helpers.
 *
 * These exercise pure functions only; live API calls are not made.
 */

import { describe, expect, it } from "vitest";
import { createResolver, generateSyncHash, toWritePayload } from "./shared.js";
import type {
  Bookmark,
  BookmarkWritePayload,
  Category,
  CategoryWritePayload,
} from "./types.js";

describe("generateSyncHash", () => {
  it("returns an uppercase hex SHA-256 string", () => {
    const hash = generateSyncHash();
    expect(hash).toMatch(/^[0-9A-F]{64}$/);
  });

  it("returns a different value on each call", () => {
    const a = generateSyncHash();
    const b = generateSyncHash();
    expect(a).not.toBe(b);
  });
});

describe("createResolver", () => {
  const bookmarks: Bookmark[] = [
    { uid: "AAA-1", title: "Salmon Recipe", url: "https://example.com/salmon", order_flag: 0 },
    { uid: "AAA-2", title: "Salmon Sushi", url: "https://example.com/sushi", order_flag: 1 },
    { uid: "AAA-3", title: "Beef Stew", url: "https://example.com/beef", order_flag: 2 },
  ];

  const resolveBookmark = createResolver<Bookmark>("bookmarks", (b) => b.title);

  it("resolves by exact UID (case-insensitive)", () => {
    expect(resolveBookmark(bookmarks, "aaa-1")?.title).toBe("Salmon Recipe");
  });

  it("resolves by exact title (case-insensitive)", () => {
    expect(resolveBookmark(bookmarks, "salmon recipe")?.uid).toBe("AAA-1");
  });

  it("resolves by unique partial title match", () => {
    expect(resolveBookmark(bookmarks, "stew")?.uid).toBe("AAA-3");
  });

  it("returns null when nothing matches", () => {
    expect(resolveBookmark(bookmarks, "tofu")).toBeNull();
  });

  it("throws when partial match is ambiguous", () => {
    expect(() => resolveBookmark(bookmarks, "salmon")).toThrow(/Multiple bookmarks/);
  });

  it("uses the supplied type name in ambiguity errors", () => {
    const categories: Category[] = [
      { uid: "C-1", name: "Salmon Dishes", order_flag: 0, parent_uid: null },
      { uid: "C-2", name: "Salmon Sides", order_flag: 1, parent_uid: null },
    ];
    const resolveCategory = createResolver<Category>("categories", (c) => c.name);
    expect(() => resolveCategory(categories, "salmon")).toThrow(/Multiple categories/);
  });
});

describe("toWritePayload", () => {
  const bookmark: Bookmark = {
    uid: "BBB-1",
    title: "Original",
    url: "https://example.com/original",
    order_flag: 5,
  };

  it("preserves entity fields and adds hash + deleted=false", () => {
    const payload = toWritePayload<Bookmark, BookmarkWritePayload>(bookmark);
    expect(payload.uid).toBe("BBB-1");
    expect(payload.title).toBe("Original");
    expect(payload.url).toBe("https://example.com/original");
    expect(payload.order_flag).toBe(5);
    expect(payload.deleted).toBe(false);
    expect(payload.hash).toMatch(/^[0-9A-F]{64}$/);
  });

  it("applies overrides on top of source fields", () => {
    const payload = toWritePayload<Bookmark, BookmarkWritePayload>(bookmark, {
      title: "Renamed",
      deleted: true,
    });
    expect(payload.title).toBe("Renamed");
    expect(payload.deleted).toBe(true);
    expect(payload.url).toBe("https://example.com/original");
  });

  it("regenerates a fresh hash on every call", () => {
    const a = toWritePayload<Bookmark, BookmarkWritePayload>(bookmark);
    const b = toWritePayload<Bookmark, BookmarkWritePayload>(bookmark);
    expect(a.hash).not.toBe(b.hash);
  });

  it("handles category writes with parent_uid", () => {
    const category: Category = {
      uid: "CAT-1",
      name: "Bread",
      order_flag: 0,
      parent_uid: null,
    };
    const payload = toWritePayload<Category, CategoryWritePayload>(category, {
      parent_uid: "ROOT-1",
    });
    expect(payload.parent_uid).toBe("ROOT-1");
    expect(payload.deleted).toBe(false);
    expect(payload.hash).toMatch(/^[0-9A-F]{64}$/);
  });
});
