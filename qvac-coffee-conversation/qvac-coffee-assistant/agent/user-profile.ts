// ============================================================================
// User Profile Storage
// Handles loading, saving, and managing user profile data
// ============================================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { dirname, join } from "path"
import type { UserProfile } from "./types"

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_PROFILE_PATH = join(process.cwd(), "data", "user-profile.json")

// ============================================================================
// Default Profile
// ============================================================================

/**
 * Create a default user profile
 */
export const createDefaultUserProfile = (): UserProfile => ({
  name: "Marco",
  defaultAddress: "PlanB Stage, El Salvador",
  preferredPaymentCurrency: "sats",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

// ============================================================================
// File Operations
// ============================================================================

/**
 * Ensure the data directory exists
 */
const ensureDataDirectory = (path: string): void => {
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/**
 * Load user profile from disk
 */
export const loadUserProfile = (path?: string): UserProfile => {
  const profilePath = path ?? DEFAULT_PROFILE_PATH

  if (!existsSync(profilePath)) {
    throw new Error(`User profile not found at ${profilePath}`)
  }

  try {
    const content = readFileSync(profilePath, "utf-8")
    return JSON.parse(content) as UserProfile
  } catch (error) {
    throw new Error(`Failed to parse user profile: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Save user profile to disk
 */
export const saveUserProfile = (profile: UserProfile, path?: string): void => {
  const profilePath = path ?? DEFAULT_PROFILE_PATH
  ensureDataDirectory(profilePath)

  const updatedProfile: UserProfile = {
    ...profile,
    updatedAt: new Date().toISOString(),
  }

  writeFileSync(profilePath, JSON.stringify(updatedProfile, null, 2), "utf-8")
}

/**
 * Load or create user profile
 */
export const loadOrCreateUserProfile = (path?: string): UserProfile => {
  const profilePath = path ?? DEFAULT_PROFILE_PATH

  try {
    return loadUserProfile(profilePath)
  } catch {
    // Create default profile
    const profile = createDefaultUserProfile()
    saveUserProfile(profile, profilePath)
    return profile
  }
}

/**
 * Check if user profile exists
 */
export const userProfileExists = (path?: string): boolean => {
  const profilePath = path ?? DEFAULT_PROFILE_PATH
  return existsSync(profilePath)
}

/**
 * Update user profile fields
 */
export const updateUserProfile = (
  updates: Partial<Omit<UserProfile, "createdAt" | "updatedAt">>,
  path?: string
): UserProfile => {
  const profilePath = path ?? DEFAULT_PROFILE_PATH

  let profile: UserProfile
  try {
    profile = loadUserProfile(profilePath)
  } catch {
    profile = createDefaultUserProfile()
  }

  const updatedProfile: UserProfile = {
    ...profile,
    ...updates,
    updatedAt: new Date().toISOString(),
  }

  saveUserProfile(updatedProfile, profilePath)
  return updatedProfile
}

/**
 * Delete user profile
 */
export const deleteUserProfile = (path?: string): boolean => {
  const profilePath = path ?? DEFAULT_PROFILE_PATH

  if (!existsSync(profilePath)) {
    return false
  }

  try {
    const { unlinkSync } = require("fs")
    unlinkSync(profilePath)
    return true
  } catch {
    return false
  }
}

// ============================================================================
// Profile Validation
// ============================================================================

/**
 * Validate user profile structure
 */
export const validateUserProfile = (
  profile: unknown
): { valid: boolean; errors: string[] } => {
  const errors: string[] = []

  if (!profile || typeof profile !== "object") {
    return { valid: false, errors: ["Profile must be an object"] }
  }

  const p = profile as Record<string, unknown>

  if (!p.name || typeof p.name !== "string") {
    errors.push("Profile must have a valid name")
  }

  if (p.defaultAddress !== undefined && typeof p.defaultAddress !== "string") {
    errors.push("defaultAddress must be a string if provided")
  }

  if (!p.preferredPaymentCurrency || typeof p.preferredPaymentCurrency !== "string") {
    errors.push("Profile must have a valid preferredPaymentCurrency")
  }

  const validCurrencies = ["sats", "USDT", "USDC", "ETH"]
  if (p.preferredPaymentCurrency && !validCurrencies.includes(p.preferredPaymentCurrency as string)) {
    errors.push(`preferredPaymentCurrency must be one of: ${validCurrencies.join(", ")}`)
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================================
// Profile Display
// ============================================================================

/**
 * Format user profile for display
 */
export const formatUserProfile = (profile: UserProfile): string => {
  const lines: string[] = [
    `Name: ${profile.name}`,
    `Default Address: ${profile.defaultAddress || "Not set"}`,
    `Payment Currency: ${profile.preferredPaymentCurrency}`,
    `Created: ${new Date(profile.createdAt).toLocaleDateString()}`,
    `Updated: ${new Date(profile.updatedAt).toLocaleDateString()}`,
  ]

  return lines.join("\n")
}

