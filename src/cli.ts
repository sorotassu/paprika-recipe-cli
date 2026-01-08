#!/usr/bin/env node

/**
 * Paprika CLI - Command line interface for Paprika Recipe Manager
 */

import { Command } from "commander";
import { createInterface } from "node:readline";
import { PaprikaClient } from "./api.js";
import {
  loadConfig,
  saveConfig,
  requireConfig,
  getConfigPath,
  clearConfig,
} from "./config.js";
import type { Recipe, Meal } from "./types.js";
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

      // Save credentials and token
      saveConfig({ email, password, token });
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
    const config = loadConfig();
    if (!config) {
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
