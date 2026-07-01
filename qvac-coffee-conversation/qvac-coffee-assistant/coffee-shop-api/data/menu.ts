import type { Drink, DrinkOption, CoffeeMenu, Store } from "../types"

// ============================================================================
// Available Options/Add-ons ($0.50 each)
// ============================================================================

export const options: DrinkOption[] = [
  {
    id: "espresso-shot",
    name: "Espresso Shot",
    price: 0.50,
    aliases: ["extra shot", "shot", "doble", "double shot", "extra espresso", "add shot"],
  },
  {
    id: "almond-milk",
    name: "Almond Milk",
    price: 0.50,
    aliases: ["leche de almendra", "almendra", "almond", "leche almendra", "almond milk"],
  },
  {
    id: "chocolate",
    name: "Chocolate",
    price: 0.50,
    aliases: ["chocolate syrup", "chocolate sauce", "mocha", "choco", "sirope de chocolate"],
  },
  {
    id: "caramel",
    name: "Caramel Flavorings",
    price: 0.50,
    aliases: ["caramel", "caramelo", "caramel syrup", "caramel sauce", "sirope de caramelo", "dulce de leche"],
  },
]

// ============================================================================
// Coffee Menu - Espresso Based Classics
// ============================================================================

export const drinks: Drink[] = [
  // Espresso Based Classics
  // {
  //   id: "specialty-espresso",
  //   name: "Specialty Blend Espresso",
  //   description: "Rich, bold shot of our signature specialty espresso blend",
  //   category: "espresso",
  //   price: 2.50,
  //   availableOptions: ["espresso-shot"],
  //   available: true,
  //   aliases: ["espresso", "café espresso", "expreso", "express", "café express", "espresso blend"],
  // },
  {
    id: "americano",
    name: "Americano",
    description: "Espresso shots with hot water for a smooth, rich taste",
    category: "espresso",
    price: 1.80,
    availableOptions: ["espresso-shot"],
    available: true,
    aliases: ["café americano", "cafe americano", "american coffee", "café negro", "negro"],
  },
  {
    id: "ristretto",
    name: "Ristretto",
    description: "A short, concentrated espresso shot with intense flavor",
    category: "espresso",
    price: 1.80,
    availableOptions: ["espresso-shot"],
    available: true,
    aliases: ["café ristretto", "ristretto shot", "short shot"],
  },
  {
    id: "lungo",
    name: "Lungo",
    description: "A longer espresso pull for a milder, extended taste",
    category: "espresso",
    price: 1.80,
    availableOptions: ["espresso-shot"],
    available: true,
    aliases: ["café lungo", "long shot", "espresso lungo"],
  },
  {
    id: "macchiato",
    name: "Macchiato / Cortadito",
    description: "Espresso marked with a dollop of foamed milk",
    category: "espresso",
    price: 2.00,
    availableOptions: ["espresso-shot", "caramel"],
    available: true,
    aliases: ["macchiato", "cortadito", "café macchiato", "café manchado", "machiato", "cortado", "café cortado"],
  },
  // {
  //   id: "moccaccino",
  //   name: "Moccaccino",
  //   description: "Espresso with chocolate and steamed milk",
  //   category: "espresso",
  //   price: 3.50,
  //   availableOptions: ["espresso-shot", "chocolate", "almond-milk"],
  //   available: true,
  //   aliases: ["mocha", "moca", "café mocha", "café moca", "mocaccino", "chocolate coffee", "café con chocolate"],
  // },
  {
    id: "hot-chocolate",
    name: "Crafted Hot Chocolate",
    description: "Rich, velvety hot chocolate made with premium cocoa",
    category: "espresso",
    price: 2.00,
    availableOptions: ["chocolate", "almond-milk"],
    available: true,
    aliases: ["hot chocolate", "chocolate caliente", "chocolatada", "chocolate con leche", "cocoa", "cocoa caliente"],
  },

  // Espresso Based Classics with Milk
  {
    id: "cappuccino",
    name: "Cappuccino",
    description: "Espresso with equal parts steamed milk and velvety foam",
    category: "espresso-milk",
    price: 2.00,
    availableOptions: ["espresso-shot", "almond-milk", "chocolate", "caramel"],
    available: true,
    aliases: ["capuchino", "capucino", "cappucino", "café cappuccino"],
  },
  {
    id: "latte",
    name: "Latte",
    description: "Espresso with steamed milk and a light layer of foam",
    category: "espresso-milk",
    price: 2.00,
    availableOptions: ["espresso-shot", "almond-milk", "chocolate", "caramel"],
    available: true,
    aliases: ["café con leche", "cafe con leche", "café latte", "cafe latte", "caffe latte", "late"],
  },
  {
    id: "flat-white",
    name: "Flat White",
    description: "Ristretto shots with steamed whole milk, microfoam texture",
    category: "espresso-milk",
    price: 2.20,
    availableOptions: ["espresso-shot", "almond-milk"],
    available: true,
    aliases: ["cortado", "café cortado", "flat white coffee"],
  },
  // {
  //   id: "chai-espresso",
  //   name: "Chai Tea with Espresso",
  //   description: "Spiced chai tea with steamed milk and an espresso shot",
  //   category: "espresso-milk",
  //   price: 4.50,
  //   availableOptions: ["espresso-shot", "almond-milk"],
  //   available: true,
  //   aliases: ["chai latte", "té chai", "chai con espresso", "dirty chai", "chai tea", "té chai con leche"],
  // },

  // Cold Espresso Based Classics
  {
    id: "iced-coffee",
    name: "Iced Coffee",
    description: "Chilled espresso-based coffee served over ice",
    category: "cold",
    price: 2.00,
    availableOptions: ["espresso-shot", "almond-milk", "chocolate", "caramel"],
    available: true,
    aliases: ["café helado", "cafe helado", "café frío", "cafe frio", "cold coffee"],
  },
  {
    id: "iced-latte",
    name: "Iced Latte",
    description: "Espresso and milk served over ice",
    category: "cold",
    price: 2.20,
    availableOptions: ["espresso-shot", "almond-milk", "chocolate", "caramel"],
    available: true,
    aliases: ["latte helado", "café con leche frío", "iced cafe con leche", "cold latte"],
  },
  {
    id: "cascara",
    name: "Coffee Cherry Brewed Tea (Cascara)",
    description: "Brewed tea made from dried coffee cherry skins",
    category: "cold",
    price: 2.00,
    availableOptions: [],
    available: true,
    aliases: ["cascara", "cascara tea", "té de cascara", "coffee cherry tea", "cherry tea"],
  },
  {
    id: "espresso-tonic",
    name: "Espresso Tonic",
    description: "Espresso shot poured over tonic water and ice",
    category: "cold",
    price: 2.20,
    availableOptions: ["espresso-shot"],
    available: true,
    aliases: ["tonic", "espresso con tonica", "café tonic", "coffee tonic"],
  },
  {
    id: "iced-chocolate",
    name: "Iced Chocolate",
    description: "Rich chocolate drink served cold over ice",
    category: "cold",
    price: 2.20,
    availableOptions: ["almond-milk", "chocolate"],
    available: true,
    aliases: ["chocolate helado", "chocolate frío", "cold chocolate", "iced cocoa"],
  },
]

// ============================================================================
// Store Locations
// ============================================================================

export const stores: Store[] = [
  {
    id: "downtown-main",
    name: "Downtown Main Street",
    address: "123 Main Street",
    city: "Downtown",
    hours: "6:00 AM - 9:00 PM",
    available: true,
  },
  {
    id: "midtown-plaza",
    name: "Midtown Plaza",
    address: "456 Commerce Blvd",
    city: "Midtown",
    hours: "7:00 AM - 8:00 PM",
    available: true,
  },
  {
    id: "uptown-central",
    name: "Uptown Central",
    address: "789 Park Avenue",
    city: "Uptown",
    hours: "6:30 AM - 10:00 PM",
    available: true,
  },
  {
    id: "westside-market",
    name: "Westside Market",
    address: "321 Market Street",
    city: "Westside",
    hours: "7:00 AM - 7:00 PM",
    available: true,
  },
]

// ============================================================================
// Menu Export
// ============================================================================

export const menu: CoffeeMenu = {
  drinks,
  options,
}

// ============================================================================
// Helper Functions
// ============================================================================

export const getDrinkById = (id: string): Drink | undefined => {
  return drinks.find((drink) => drink.id === id)
}

/**
 * Find a drink by name or alias (case-insensitive)
 * This is useful for matching Spanish names like "café con leche" to "latte"
 */
export const getDrinkByNameOrAlias = (nameOrAlias: string): Drink | undefined => {
  const lowerQuery = nameOrAlias.toLowerCase().trim()
  
  return drinks.find((drink) => {
    // Check exact ID match
    if (drink.id === lowerQuery) return true
    
    // Check name match
    if (drink.name.toLowerCase() === lowerQuery) return true
    
    // Check aliases
    if (drink.aliases?.some(alias => alias.toLowerCase() === lowerQuery)) return true
    
    // Check partial name/alias match for fuzzy matching
    if (drink.name.toLowerCase().includes(lowerQuery)) return true
    if (drink.aliases?.some(alias => alias.toLowerCase().includes(lowerQuery))) return true
    
    // Check if query contains the drink name or alias
    if (lowerQuery.includes(drink.name.toLowerCase())) return true
    if (drink.aliases?.some(alias => lowerQuery.includes(alias.toLowerCase()))) return true
    
    return false
  })
}

export const getOptionById = (id: string): DrinkOption | undefined => {
  if (!id) return undefined
  const want = id.toLowerCase().trim()
  // exact id (case-insensitive) first, then fall back to name/alias so a slightly-off value
  // from the model (e.g. "Chocolate", "almond milk") still resolves and gets priced.
  return options.find((option) => option.id.toLowerCase() === want) || getOptionByNameOrAlias(id)
}

/**
 * Find an option by name or alias (case-insensitive)
 */
export const getOptionByNameOrAlias = (nameOrAlias: string): DrinkOption | undefined => {
  const lowerQuery = nameOrAlias.toLowerCase().trim()
  
  return options.find((option) => {
    if (option.id === lowerQuery) return true
    if (option.name.toLowerCase() === lowerQuery) return true
    if (option.aliases?.some(alias => alias.toLowerCase() === lowerQuery)) return true
    if (option.name.toLowerCase().includes(lowerQuery)) return true
    if (option.aliases?.some(alias => alias.toLowerCase().includes(lowerQuery))) return true
    return false
  })
}

export const getStoreById = (id: string): Store | undefined => {
  return stores.find((store) => store.id === id)
}

export const searchDrinks = (query: string): Drink[] => {
  const lowerQuery = query.toLowerCase()
  return drinks.filter(
    (drink) =>
      drink.available &&
      (drink.name.toLowerCase().includes(lowerQuery) ||
        drink.description.toLowerCase().includes(lowerQuery) ||
        drink.category.toLowerCase().includes(lowerQuery) ||
        drink.aliases?.some(alias => alias.toLowerCase().includes(lowerQuery)))
  )
}

export const getDrinksByCategory = (category: string): Drink[] => {
  return drinks.filter(
    (drink) => drink.available && drink.category === category
  )
}

export const calculateItemPrice = (
  drinkId: string,
  optionIds: string[]
): number => {
  const drink = getDrinkById(drinkId)
  if (!drink) return 0

  const basePrice = drink.price
  const optionsTotal = optionIds.reduce((total, optionId) => {
    const option = getOptionById(optionId)
    return total + (option?.price ?? 0)
  }, 0)

  return basePrice + optionsTotal
}

// Delivery fee based on mode
export const DELIVERY_FEE = 0.50
export const PICKUP_FEE = 0.00
