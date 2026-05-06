#!/usr/bin/env node

/**
 * Paprika CLI - Command line interface for Paprika Recipe Manager
 */

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { createInterface } from "node:readline";
import { PaprikaClient } from "./api.js";
import {
  loadConfig,
  loadConfigFromEnv,
  saveConfig,
  requireConfig,
  getConfigPath,
  clearConfig,
} from "./config.js";
import type { Category, Meal, Recipe, RecipeWritePayload } from "./types.js";
import { ExitCode } from "./types.js";
import { setNoColor, printError, printSuccess, style } from "./output.js";

const VERSION = "0.1.0";

const program = new Command();

program
  .name("paprika")
  .description("Unofficial CLI for Paprika Recipe Manager")
  .version(VERSION, "-V, --version", "Show version number")
  .option("--no-color", "Disable colored output")
  .configureOutput({
    writeErr: (str) => process.stderr.write(str),
    writeOut: (str) => process.stdout.write(str),
    outputError: (str, write) => write(str),
  })
  .exitOverride((err) => {
    if (
      err.code === "commander.missingArgument" ||
      err.code === "commander.unknownOption" ||
      err.code === "commander.invalidArgument" ||
      err.code === "commander.missingMandatoryOptionValue"
    ) {
      process.exit(ExitCode.InvalidUsage);
    }
    process.exit(err.exitCode);
  })
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts() as { color?: boolean };
    if (opts.color === false) {
      setNoColor(true);
    }
  });

/**
 * Prompt for input with optional hidden mode (for passwords)
 */
function prompt(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (hidden && process.stdin.isTTY) {
      process.stdout.write(question);
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf8");

      let password = "";
      const onData = (char: string) => {
        if (char === "\n" || char === "\r" || char === "\u0004") {
          stdin.setRawMode(false);
          stdin.removeListener("data", onData);
          rl.close();
          process.stdout.write("\n");
          resolve(password);
        } else if (char === "\u0003") {
          // Ctrl-C
          stdin.setRawMode(false);
          rl.close();
          process.exit(ExitCode.Failure);
        } else if (char === "\u007F" || char === "\b") {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
          }
        } else {
          password += char;
        }
      };
      stdin.on("data", onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

// ============================================
// Auth Commands
// ============================================

program
  .command("auth")
  .description("Authenticate with Paprika cloud sync (interactive)")
  .action(async () => {
    if (!process.stdin.isTTY) {
      printError("Interactive authentication requires a TTY.");
      printError(
        "For non-interactive use, set PAPRIKA_EMAIL and PAPRIKA_PASSWORD environment variables."
      );
      process.exit(ExitCode.InvalidUsage);
    }

    try {
      const email = await prompt("Email: ");
      const password = await prompt("Password: ", true);

      if (!email || !password) {
        printError("Email and password are required.");
        process.exit(ExitCode.InvalidUsage);
      }

      console.log("Verifying credentials...");
      const client = new PaprikaClient({ email, password });
      const token = await client.login();

      saveConfig({ email, token });
      printSuccess("Authenticated successfully.");
      console.log(style.dim(`Config saved to ${getConfigPath()}`));
    } catch (error) {
      printError(
        `Authentication failed: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(ExitCode.AuthFailure);
    }
  });

program
  .command("logout")
  .description("Clear stored credentials")
  .action(() => {
    clearConfig();
    printSuccess("Credentials cleared.");
  });

program
  .command("whoami")
  .description("Show current authenticated user")
  .option("--json", "Output as JSON")
  .action((options: { json?: boolean }) => {
    const config = loadConfigFromEnv() ?? loadConfig();
    if (!config?.email || (!config.token && !config.password)) {
      if (options.json) {
        console.log(JSON.stringify({ authenticated: false }));
      } else {
        console.log("Not authenticated. Run: paprika auth");
      }
      return;
    }
    if (options.json) {
      console.log(
        JSON.stringify({ authenticated: true, email: config.email }, null, 2)
      );
    } else {
      console.log(`Authenticated as: ${style.bold(config.email)}`);
    }
  });

// ============================================
// Recipe Commands
// ============================================

program
  .command("recipes")
  .description("List all recipes")
  .option("--json", "Output as JSON")
  .option("--category <category>", "Filter by category name")
  .action(async (options: { json?: boolean; category?: string }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      if (!options.json) {
        console.log("Fetching recipes...");
      }
      const recipes = await client.getAllRecipes();
      let active = recipes.filter((r) => !r.in_trash);

      // Filter by category if specified
      if (options.category) {
        const categoryLower = options.category.toLowerCase();
        active = active.filter((r) =>
          r.categories.some((c) => c.toLowerCase().includes(categoryLower))
        );
      }

      if (options.json) {
        console.log(JSON.stringify(active, null, 2));
      } else {
        const categoryMsg = options.category
          ? ` in category "${options.category}"`
          : "";
        console.log(`\nFound ${active.length} recipes${categoryMsg}:\n`);
        for (const recipe of active.sort((a, b) =>
          a.name.localeCompare(b.name)
        )) {
          const rating =
            recipe.rating > 0 ? style.dim(` (${recipe.rating}★)`) : "";
          console.log(`• ${style.bold(recipe.name)}${rating}`);
        }
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

/**
 * Check if a string looks like a UUID
 */
function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    str
  );
}

type ImportedRecipeInput = Partial<RecipeWritePayload> & {
  uid?: string;
  categories?: string[];
};

function normalizeImportedCategories(
  categories: ImportedRecipeInput["categories"] | undefined,
  categoryMap: Map<string, string>,
  existingCategories: string[] = []
): string[] {
  if (categories === undefined) {
    return existingCategories;
  }

  return categories.map((value) => {
    if (typeof value !== "string") {
      throw new Error(`Invalid category value: ${String(value)}`);
    }

    if (isUuid(value)) {
      return value.toUpperCase();
    }

    const match = categoryMap.get(value.trim().toLowerCase());
    if (!match) {
      throw new Error(`Unknown category: ${value}`);
    }

    return match;
  });
}

function buildCategoryMap(categories: Category[]): Map<string, string> {
  return new Map(
    categories.map((category) => [category.name.trim().toLowerCase(), category.uid])
  );
}

function normalizeImportedRecipe(
  input: ImportedRecipeInput,
  options: {
    categoryMap: Map<string, string>;
    existingRecipe?: Recipe | null;
  }
): RecipeWritePayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Each imported recipe must be a JSON object.");
  }

  const existingRecipe = options.existingRecipe ?? null;
  const recipe: RecipeWritePayload = {
    uid:
      existingRecipe?.uid ??
      (typeof input.uid === "string" && isUuid(input.uid)
        ? input.uid.toUpperCase()
        : randomUUID().toUpperCase()),
    name:
      typeof input.name === "string"
        ? input.name.trim()
        : existingRecipe?.name ?? "",
    ingredients:
      typeof input.ingredients === "string"
        ? input.ingredients
        : existingRecipe?.ingredients ?? "",
    directions:
      typeof input.directions === "string"
        ? input.directions
        : existingRecipe?.directions ?? "",
    description:
      typeof input.description === "string"
        ? input.description
        : existingRecipe?.description ?? "",
    notes:
      typeof input.notes === "string" ? input.notes : existingRecipe?.notes ?? "",
    nutritional_info:
      typeof input.nutritional_info === "string"
        ? input.nutritional_info
        : existingRecipe?.nutritional_info ?? "",
    servings:
      typeof input.servings === "string"
        ? input.servings
        : existingRecipe?.servings ?? "",
    difficulty:
      typeof input.difficulty === "string"
        ? input.difficulty
        : existingRecipe?.difficulty ?? "",
    prep_time:
      typeof input.prep_time === "string"
        ? input.prep_time
        : existingRecipe?.prep_time ?? "",
    cook_time:
      typeof input.cook_time === "string"
        ? input.cook_time
        : existingRecipe?.cook_time ?? "",
    total_time:
      typeof input.total_time === "string"
        ? input.total_time
        : existingRecipe?.total_time ?? "",
    source:
      typeof input.source === "string" ? input.source : existingRecipe?.source ?? "",
    source_url:
      typeof input.source_url === "string"
        ? input.source_url
        : existingRecipe?.source_url ?? "",
    image_url:
      typeof input.image_url === "string"
        ? input.image_url
        : existingRecipe?.image_url ?? null,
    photo:
      typeof input.photo === "string" ? input.photo : existingRecipe?.photo ?? "",
    photo_hash:
      typeof input.photo_hash === "string"
        ? input.photo_hash
        : existingRecipe?.photo_hash ?? "",
    photo_large:
      typeof input.photo_large === "string"
        ? input.photo_large
        : existingRecipe?.photo_large ?? null,
    scale:
      typeof input.scale === "string" || input.scale === null
        ? input.scale
        : existingRecipe?.scale ?? null,
    hash: "",
    categories: normalizeImportedCategories(
      input.categories,
      options.categoryMap,
      existingRecipe?.categories ?? []
    ),
    rating:
      typeof input.rating === "number" && Number.isFinite(input.rating)
        ? Math.max(0, Math.trunc(input.rating))
        : existingRecipe?.rating ?? 0,
    in_trash: false,
    is_pinned:
      typeof input.is_pinned === "boolean"
        ? input.is_pinned
        : existingRecipe?.is_pinned ?? false,
    on_favorites:
      typeof input.on_favorites === "boolean"
        ? input.on_favorites
        : existingRecipe?.on_favorites ?? false,
    created:
      typeof input.created === "string"
        ? input.created.trim()
        : existingRecipe?.created ??
          new Date().toISOString().slice(0, 19).replace("T", " "),
    deleted: false,
  };

  if (!recipe.name) {
    throw new Error("Imported recipe is missing a name.");
  }

  const { hash: _hash, ...hashInput } = recipe;

  recipe.hash = createHash("sha256")
    .update(JSON.stringify(Object.fromEntries(Object.entries(hashInput).sort())))
    .digest("hex")
    .toUpperCase();

  return recipe;
}

program
  .command("recipe")
  .description("Get a recipe by UID or name")
  .argument("<identifier>", "Recipe UID or name (partial match supported)")
  .option("--json", "Output as JSON")
  .option("--ingredients-only", "Only show ingredients")
  .action(
    async (
      identifier: string,
      options: { json?: boolean; ingredientsOnly?: boolean }
    ) => {
      const config = requireConfig();
      const client = new PaprikaClient(config);

      try {
        let recipe: Recipe | null = null;

        // If it looks like a UUID, try fetching directly first
        if (isUuid(identifier)) {
          try {
            recipe = await client.getRecipe(identifier);
          } catch {
            // UID not found, fall through to name search
          }
        }

        // If not found by UID, search by name
        if (!recipe) {
          if (!options.json) {
            console.log("Searching recipes...");
          }
          recipe = await client.findRecipeByName(identifier);
        }

        if (!recipe) {
          printError(`Recipe not found: ${identifier}`);
          process.exit(ExitCode.Failure);
        }

        if (options.json) {
          console.log(JSON.stringify(recipe, null, 2));
        } else if (options.ingredientsOnly) {
          console.log(`\nIngredients for "${recipe.name}":\n`);
          console.log(recipe.ingredients);
        } else {
          printRecipe(recipe);
        }
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        process.exit(ExitCode.Failure);
      }
    }
  );

program
  .command("import-recipe")
  .description("Import one or more recipes from JSON directly into Paprika cloud sync")
  .argument(
    "<path>",
    "Path to a JSON file containing a recipe object or array of recipe objects"
  )
  .option("--json", "Output as JSON")
  .option("--dry-run", "Validate and prepare uploads without writing to Paprika")
  .option(
    "--allow-duplicate",
    "Create a new recipe even if an exact name match already exists"
  )
  .option(
    "--update-existing",
    "Update the exact-name match instead of creating a duplicate"
  )
  .action(
    async (
      path: string,
      options: {
        json?: boolean;
        dryRun?: boolean;
        allowDuplicate?: boolean;
        updateExisting?: boolean;
      }
    ) => {
      if (options.allowDuplicate && options.updateExisting) {
        printError("Choose either --allow-duplicate or --update-existing, not both.");
        process.exit(ExitCode.InvalidUsage);
      }

      const config = requireConfig();
      const client = new PaprikaClient(config);

      try {
        const raw = readFileSync(path, "utf-8");
        const parsed = JSON.parse(raw) as ImportedRecipeInput | ImportedRecipeInput[];
        const inputRecipes = Array.isArray(parsed) ? parsed : [parsed];
        const categoryMap = buildCategoryMap(await client.getCategories());
        const existingRecipesByName = new Map<string, Recipe[]>();

        if (!options.allowDuplicate || options.updateExisting) {
          if (!options.json) {
            console.log("Fetching existing recipes...");
          }

          const existingRecipes = (await client.getAllRecipes()).filter(
            (recipe) => !recipe.in_trash
          );

          for (const recipe of existingRecipes) {
            const key = recipe.name.trim().toLowerCase();
            const bucket = existingRecipesByName.get(key) ?? [];
            bucket.push(recipe);
            existingRecipesByName.set(key, bucket);
          }
        }

        const results: Array<{
          action: string;
          name: string;
          uid: string;
          categories: string[];
        }> = [];

        for (const input of inputRecipes) {
          const inputName = typeof input.name === "string" ? input.name.trim() : "";
          const matches = inputName
            ? existingRecipesByName.get(inputName.toLowerCase()) ?? []
            : [];

          if (matches.length > 1 && options.updateExisting) {
            throw new Error(
              `Multiple existing recipes named "${inputName}". Refusing ambiguous update.`
            );
          }

          if (matches.length > 0 && !options.allowDuplicate && !options.updateExisting) {
            throw new Error(
              `Recipe already exists: ${inputName}. Use --update-existing or --allow-duplicate.`
            );
          }

          const existingRecipe = options.updateExisting ? (matches[0] ?? null) : null;
          const recipe = normalizeImportedRecipe(input, {
            categoryMap,
            existingRecipe,
          });
          const action = existingRecipe ? "update" : "create";

          if (options.dryRun) {
            results.push({
              action,
              name: recipe.name,
              uid: recipe.uid,
              categories: recipe.categories,
            });
            continue;
          }

          const saved = await client.saveRecipe(recipe);
          results.push({
            action: `${action}d`,
            name: saved.name,
            uid: saved.uid,
            categories: saved.categories,
          });
        }

        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
        } else if (results.length === 1) {
          const result = results[0]!;
          const verb = options.dryRun
            ? `Would ${result.action}`
            : result.action.charAt(0).toUpperCase() + result.action.slice(1);
          console.log(`${verb} recipe: ${style.bold(result.name)} (${result.uid})`);
        } else {
          const verb = options.dryRun ? "Would import" : "Imported";
          console.log(`${verb} ${results.length} recipes:`);
          for (const result of results) {
            console.log(`• ${result.action}: ${style.bold(result.name)} (${result.uid})`);
          }
        }
      } catch (error) {
        printError(error instanceof Error ? error.message : String(error));
        process.exit(ExitCode.Failure);
      }
    }
  );

program
  .command("search")
  .description("Search recipes by name or description")
  .argument("<query>", "Search query")
  .option("--json", "Output as JSON")
  .action(async (query: string, options: { json?: boolean }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      if (!options.json) {
        console.log("Searching recipes...");
      }
      const recipes = await client.searchRecipes(query);
      const active = recipes.filter((r) => !r.in_trash);

      if (options.json) {
        console.log(JSON.stringify(active, null, 2));
      } else if (active.length === 0) {
        console.log(`No recipes found matching "${query}"`);
      } else {
        console.log(`\nFound ${active.length} recipes matching "${query}":\n`);
        for (const recipe of active) {
          console.log(`• ${style.bold(recipe.name)}`);
        }
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

// ============================================
// Meal Plan Commands
// ============================================

program
  .command("meals")
  .description("Show meal plan")
  .option("--json", "Output as JSON")
  .option("--date <date>", "Filter by date (YYYY-MM-DD)")
  .action(async (options: { json?: boolean; date?: string }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      let meals = await client.getMeals();

      if (options.date) {
        meals = meals.filter((m) => m.date === options.date);
      }

      if (options.json) {
        console.log(JSON.stringify(meals, null, 2));
      } else if (meals.length === 0) {
        console.log("No meals planned.");
      } else {
        // Group by date
        const byDate = new Map<string, Meal[]>();
        for (const meal of meals) {
          const existing = byDate.get(meal.date) ?? [];
          existing.push(meal);
          byDate.set(meal.date, existing);
        }

        const mealTypes = ["Breakfast", "Lunch", "Dinner", "Snack"];

        for (const [date, dateMeals] of [...byDate.entries()].sort()) {
          console.log(`\n${style.bold(date)}:`);
          for (const meal of dateMeals.sort((a, b) => a.type - b.type)) {
            const type = mealTypes[meal.type] ?? "Other";
            console.log(`  ${style.dim(type + ":")} ${meal.name}`);
          }
        }
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

// ============================================
// Grocery Commands
// ============================================

program
  .command("groceries")
  .description("Show grocery list")
  .option("--json", "Output as JSON")
  .option("--all", "Include purchased items")
  .action(async (options: { json?: boolean; all?: boolean }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      const items = await client.getGroceries();
      const filtered = options.all ? items : items.filter((i) => !i.purchased);

      if (options.json) {
        console.log(JSON.stringify(filtered, null, 2));
      } else if (filtered.length === 0) {
        console.log("Grocery list is empty.");
      } else {
        // Group by aisle
        const byAisle = new Map<string, typeof items>();
        for (const item of filtered) {
          const aisle = item.aisle || "Uncategorized";
          const existing = byAisle.get(aisle) ?? [];
          existing.push(item);
          byAisle.set(aisle, existing);
        }

        console.log(`\nGrocery list (${filtered.length} items):\n`);
        for (const [aisle, aisleItems] of [...byAisle.entries()].sort()) {
          console.log(`${style.bold(aisle)}:`);
          for (const item of aisleItems) {
            const qty = item.quantity ? `${item.quantity} ` : "";
            const purchased = item.purchased ? style.dim(" ✓") : "";
            console.log(`  • ${qty}${item.name}${purchased}`);
          }
        }
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

// ============================================
// Category Commands
// ============================================

program
  .command("categories")
  .description("List recipe categories")
  .option("--json", "Output as JSON")
  .action(async (options: { json?: boolean }) => {
    const config = requireConfig();
    const client = new PaprikaClient(config);

    try {
      const categories = await client.getCategories();

      if (options.json) {
        console.log(JSON.stringify(categories, null, 2));
      } else {
        console.log("\nCategories:\n");
        for (const cat of categories.sort((a, b) =>
          a.name.localeCompare(b.name)
        )) {
          console.log(`• ${cat.name}`);
        }
      }
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      process.exit(ExitCode.Failure);
    }
  });

// ============================================
// Helper Functions
// ============================================

function printRecipe(recipe: Recipe): void {
  console.log(`\n${"=".repeat(50)}`);
  console.log(style.bold(recipe.name));
  console.log("=".repeat(50));

  if (recipe.description) {
    console.log(`\n${recipe.description}`);
  }

  const meta: string[] = [];
  if (recipe.prep_time) meta.push(`Prep: ${recipe.prep_time}`);
  if (recipe.cook_time) meta.push(`Cook: ${recipe.cook_time}`);
  if (recipe.total_time) meta.push(`Total: ${recipe.total_time}`);
  if (recipe.servings) meta.push(`Servings: ${recipe.servings}`);
  if (recipe.difficulty) meta.push(`Difficulty: ${recipe.difficulty}`);
  if (recipe.rating > 0) meta.push(`Rating: ${recipe.rating}★`);

  if (meta.length > 0) {
    console.log(`\n${style.dim(meta.join(" | "))}`);
  }

  if (recipe.source) {
    console.log(`\n${style.dim("Source:")} ${recipe.source}`);
    if (recipe.source_url) {
      console.log(`${style.dim("URL:")} ${recipe.source_url}`);
    }
  }

  if (recipe.ingredients) {
    console.log(`\n${style.bold("--- Ingredients ---")}`);
    console.log(recipe.ingredients);
  }

  if (recipe.directions) {
    console.log(`\n${style.bold("--- Directions ---")}`);
    console.log(recipe.directions);
  }

  if (recipe.notes) {
    console.log(`\n${style.bold("--- Notes ---")}`);
    console.log(recipe.notes);
  }

  if (recipe.nutritional_info) {
    console.log(`\n${style.bold("--- Nutrition ---")}`);
    console.log(recipe.nutritional_info);
  }

  console.log("");
}

program.parse();
