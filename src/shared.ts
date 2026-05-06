/**
 * Shared helpers for Paprika CLI
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  Bookmark,
  Category,
  Meal,
  GroceryItem,
  Recipe,
} from "./types.js";

export type Entity = (Bookmark | Category | Meal | GroceryItem | Recipe) & {
  uid: string;
};

export type EntityWithName = Entity & { name: string };
export type EntityWithTitle = Entity & { title: string };

export function createResolver<T extends EntityWithName | EntityWithTitle>(
  typeName: string,
  nameFn: (item: T) => string
) {
  return function resolve(items: T[], identifier: string): T | null {
    const trimmed = identifier.trim();
    const normalizedUid = trimmed.toUpperCase();
    const byUid = items.find((item) => item.uid.toUpperCase() === normalizedUid);
    if (byUid) {
      return byUid;
    }

    const normalized = trimmed.toLowerCase();
    const exact = items.find(
      (item) => nameFn(item).trim().toLowerCase() === normalized
    );
    if (exact) {
      return exact;
    }

    const partialMatches = items.filter((item) =>
      nameFn(item).trim().toLowerCase().includes(normalized)
    );
    if (partialMatches.length > 1) {
      const names = partialMatches.map(nameFn).join(", ");
      throw new Error(
        `Multiple ${typeName} matched "${identifier}": ${names}. Use a more specific name or the UID.`
      );
    }

    return partialMatches[0] ?? null;
  };
}

export function toWritePayload<
  T extends Entity,
  U extends { hash: string; deleted: boolean }
>(item: T, overrides: Partial<U> = {}): U {
  return {
    ...item,
    hash: generateSyncHash(),
    deleted: false,
    ...overrides,
  } as unknown as U;
}

export function generateSyncHash(): string {
  return createHash("sha256")
    .update(randomUUID().toUpperCase())
    .digest("hex")
    .toUpperCase();
}
