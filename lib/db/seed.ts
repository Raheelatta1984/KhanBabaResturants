import type { Db as Database } from "./driver";
import { hashPassword } from "../auth/password";
import {
  DEFAULT_COMMUNITY_AUTO_REPLY,
  DEFAULT_SETTINGS,
} from "../settings";
import { getTimeParts } from "../time";
import { completeBatch, startBatch } from "../production";

type VariantSeed = {
  label: string;
  sizeMl: number | null;
  price: number;
  isDefault?: boolean;
};

type ItemSeed = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  image: string;
  ingredients: string;
  allergens: string;
  spice?: boolean;
  veg?: boolean;
  featured?: boolean;
  isNew?: boolean;
  prep: number;
  variants: VariantSeed[];
  reviews?: { name: string; rating: number; comment: string }[];
};

const cents = (d: number) => Math.round(d * 100);

const CATEGORIES = [
  {
    slug: "biryani-rice",
    name: "Biryani & Rice",
    description: "Layered basmati, slow-cooked in the dum style",
    sort: 1,
  },
  {
    slug: "karahi-curries",
    name: "Karahi & Curries",
    description: "Wok-finished karahi and slow-simmered curries",
    sort: 2,
  },
  {
    slug: "tandoor-bbq",
    name: "Tandoor & BBQ",
    description: "Charcoal-grilled, straight from the clay oven",
    sort: 3,
  },
  {
    slug: "breads",
    name: "Naan & Roti",
    description: "Baked to order in our tandoor",
    sort: 4,
  },
  {
    slug: "burgers",
    name: "Burgers",
    description: "Halal patties, house sauces, fresh buns",
    sort: 5,
  },
  {
    slug: "sides",
    name: "Sides & Snacks",
    description: "Chaat, samosas and share plates",
    sort: 6,
  },
  {
    slug: "desserts",
    name: "Desserts",
    description: "Mithai made in ghee, the Lahori way",
    sort: 7,
  },
  {
    slug: "drinks",
    name: "Drinks",
    description: "Lassi, chai and cooling classics",
    sort: 8,
  },
];

const ITEMS: ItemSeed[] = [
  {
    slug: "chicken-biryani",
    name: "Chicken Biryani",
    tagline: "The house signature",
    description:
      "Aged basmati layered with marinated chicken, saffron milk and fried onions, sealed and slow-cooked on dum. Served with cooling mint raita.",
    category: "biryani-rice",
    image: "/images/biryani-chicken.jpg",
    ingredients:
      "Aged basmati rice, chicken, yoghurt, onion, tomato, saffron, ghee, ginger, garlic, garam masala, mint, coriander",
    allergens: "Milk",
    spice: true,
    featured: true,
    prep: 18,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 15.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 29.99 },
    ],
    reviews: [
      {
        name: "Ayesha K.",
        rating: 5,
        comment:
          "Genuinely the best biryani in the CBD. The 1L tub fed two of us easily.",
      },
      {
        name: "Daniel M.",
        rating: 5,
        comment:
          "Ordered extra hot — proper heat, not just chilli for the sake of it.",
      },
      {
        name: "Priya S.",
        rating: 4,
        comment:
          "Beautiful rice, generous chicken. Would love more raita with the large size.",
      },
    ],
  },
  {
    slug: "lamb-dum-biryani",
    name: "Lamb Dum Biryani",
    tagline: "Slow-cooked on the bone",
    description:
      "Lamb shoulder marinated overnight in yoghurt and whole spices, layered with basmati and cooked on dum until it falls apart.",
    category: "biryani-rice",
    image: "/images/biryani-lamb.jpg",
    ingredients:
      "Aged basmati rice, lamb shoulder, yoghurt, onion, saffron, ghee, garam masala, cardamom, black cumin, mint",
    allergens: "Milk",
    spice: true,
    featured: true,
    prep: 20,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 16.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 31.99 },
    ],
    reviews: [
      {
        name: "Omar F.",
        rating: 5,
        comment: "Lamb was falling off the bone. Reminded me of Gawalmandi.",
      },
      {
        name: "Kate L.",
        rating: 4,
        comment: "Rich and fragrant. Mild is a good starting point.",
      },
    ],
  },
  {
    slug: "goat-biryani",
    name: "Goat Biryani",
    tagline: "Weekend favourite",
    description:
      "Goat on the bone simmered with whole spices, layered with saffron rice and finished with crisp fried onions.",
    category: "biryani-rice",
    image: "/images/biryani-royal.jpg",
    ingredients:
      "Basmati rice, goat meat, yoghurt, onion, tomato, whole spices, saffron, ghee, coriander",
    allergens: "Milk",
    spice: true,
    prep: 22,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 16.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 31.99 },
    ],
  },
  {
    slug: "biryani-rice",
    name: "Biryani Rice",
    tagline: "Spiced basmati",
    description:
      "Our biryani rice on its own — aromatic, buttery and studded with whole spices. Perfect next to a curry.",
    category: "biryani-rice",
    image: "/images/biryani-royal.jpg",
    ingredients:
      "Basmati rice, ghee, onion, cumin, cardamom, cloves, bay leaf, saffron",
    allergens: "Milk",
    spice: true,
    veg: true,
    prep: 10,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 12.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 22.99 },
    ],
  },
  {
    slug: "plain-rice",
    name: "Plain Rice",
    tagline: "Steamed basmati",
    description: "Fluffy steamed basmati, cooked fresh through service.",
    category: "biryani-rice",
    image: "/images/biryani-royal.jpg",
    ingredients: "Basmati rice, water, salt",
    allergens: "None",
    veg: true,
    prep: 8,
    variants: [
      { label: "1 portion", sizeMl: 400, price: 7.99, isDefault: true },
    ],
  },
  {
    slug: "butter-chicken",
    name: "Butter Chicken",
    tagline: "Creamy, gently spiced",
    description:
      "Tandoor-charred chicken folded into a silky tomato, butter and cashew gravy with a touch of fenugreek. A crowd pleaser.",
    category: "karahi-curries",
    image: "/images/karahi-creamy.jpg",
    ingredients:
      "Chicken thigh, tomato, cream, butter, cashew paste, yoghurt, ginger, garlic, fenugreek, garam masala",
    allergens: "Milk, tree nuts",
    spice: true,
    featured: true,
    prep: 16,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 25.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 44.99 },
    ],
    reviews: [
      {
        name: "Sarah T.",
        rating: 5,
        comment: "So creamy and the spice level was spot on for the kids.",
      },
      {
        name: "Michael R.",
        rating: 4,
        comment: "Great with the garlic naan. Portion is generous.",
      },
    ],
  },
  {
    slug: "chicken-karahi",
    name: "Chicken Karahi",
    tagline: "Wok-fired, Lahori style",
    description:
      "Chicken cooked hard and fast in a karahi with tomato, green chilli and ginger — the way it is made on the roadside in Lahore.",
    category: "karahi-curries",
    image: "/images/karahi-green.jpg",
    ingredients:
      "Chicken, tomato, green chilli, ginger, garlic, cooking oil, coriander, cumin, black pepper, salt",
    allergens: "None",
    spice: true,
    featured: true,
    prep: 18,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 21.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 39.99 },
    ],
    reviews: [
      {
        name: "Hassan A.",
        rating: 5,
        comment: "Tastes like Lahore. Extra hot is the way to go.",
      },
    ],
  },
  {
    slug: "chicken-tikka-masala",
    name: "Chicken Tikka Masala",
    tagline: "Charred then simmered",
    description:
      "Tandoori chicken tikka in a rich tomato masala with a hint of smoke from the clay oven.",
    category: "karahi-curries",
    image: "/images/karahi-masala.jpg",
    ingredients:
      "Chicken tikka, tomato, onion, cream, butter, ginger, garlic, garam masala, paprika",
    allergens: "Milk",
    spice: true,
    prep: 16,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 22.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 39.99 },
    ],
  },
  {
    slug: "beef-nihari",
    name: "Beef Nihari",
    tagline: "Overnight braise",
    description:
      "Beef shank braised overnight with nihari masala until the gravy turns glossy and thick. Finished with ginger, chilli and lime.",
    category: "karahi-curries",
    image: "/images/nihari.jpg",
    ingredients:
      "Beef shank, nihari masala, onion, ginger, garlic, wheat flour, ghee, green chilli, lime",
    allergens: "Gluten",
    spice: true,
    prep: 12,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 22.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 39.99 },
    ],
    reviews: [
      {
        name: "Zainab H.",
        rating: 5,
        comment: "Deep, spicy and rich. Order the naan to go with it.",
      },
    ],
  },
  {
    slug: "daal-makhni",
    name: "Daal Makhni",
    tagline: "Slow lentils, lots of butter",
    description:
      "Black lentils simmered for hours with tomato, butter and cream until velvety. Vegetarian and deeply comforting.",
    category: "karahi-curries",
    image: "/images/daal-makhani.jpg",
    ingredients:
      "Black lentils, tomato, butter, cream, onion, garlic, cumin, chilli, coriander",
    allergens: "Milk",
    spice: true,
    veg: true,
    prep: 12,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 17.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 30.99 },
    ],
  },
  {
    slug: "chicken-tikka",
    name: "Chicken Tikka",
    tagline: "6 pieces",
    description:
      "Boneless chicken thigh marinated in spiced yoghurt and chargrilled in the tandoor. Served with mint chutney.",
    category: "tandoor-bbq",
    image: "/images/tikka-platter.jpg",
    ingredients:
      "Chicken thigh, yoghurt, lemon, ginger, garlic, red chilli, garam masala, mint chutney",
    allergens: "Milk",
    spice: true,
    featured: true,
    prep: 18,
    variants: [
      { label: "6 pieces", sizeMl: null, price: 17.99, isDefault: true },
    ],
    reviews: [
      {
        name: "Ali R.",
        rating: 5,
        comment: "Smoky and juicy. Chutney is excellent.",
      },
    ],
  },
  {
    slug: "chicken-malai-boti",
    name: "Chicken Malai Boti",
    tagline: "6 pieces",
    description:
      "Creamy, mild and tender — chicken marinated in cream, cheese and white pepper, then chargrilled.",
    category: "tandoor-bbq",
    image: "/images/tikka-grill.jpg",
    ingredients:
      "Chicken breast, cream, cheddar, yoghurt, white pepper, garlic, coriander",
    allergens: "Milk",
    spice: true,
    prep: 18,
    variants: [
      { label: "6 pieces", sizeMl: null, price: 17.99, isDefault: true },
    ],
  },
  {
    slug: "seekh-kebab",
    name: "Seekh Kebab",
    tagline: "Beef, chicken or lamb",
    description:
      "Hand-minced meat with herbs and green chilli, moulded onto skewers and grilled over charcoal.",
    category: "tandoor-bbq",
    image: "/images/kebab-platter.jpg",
    ingredients:
      "Minced beef, onion, green chilli, coriander, mint, ginger garlic, kebab masala",
    allergens: "None",
    spice: true,
    prep: 20,
    variants: [
      { label: "2 pieces", sizeMl: null, price: 16.99, isDefault: true },
      { label: "5 pieces", sizeMl: null, price: 35.99 },
    ],
  },
  {
    slug: "bbq-mix-platter",
    name: "BBQ Mix Platter",
    tagline: "Best of the grill",
    description:
      "Three chicken tikka, one chicken reshmi kebab and one lamb seekh kebab, served with raita.",
    category: "tandoor-bbq",
    image: "/images/kebab-2.jpg",
    ingredients:
      "Chicken tikka, chicken reshmi kebab, lamb seekh kebab, raita, mint chutney",
    allergens: "Milk",
    spice: true,
    prep: 22,
    variants: [
      { label: "1 platter", sizeMl: null, price: 22.99, isDefault: true },
    ],
  },
  {
    slug: "bbq-platter",
    name: "BBQ Platter",
    tagline: "Feeds 2–3",
    description:
      "Three chicken tikka, three malai boti, two reshmi kebabs and two lamb seekh kebabs with raita.",
    category: "tandoor-bbq",
    image: "/images/kebab-3.jpg",
    ingredients:
      "Chicken tikka, malai boti, reshmi kebab, lamb seekh kebab, raita",
    allergens: "Milk",
    spice: true,
    prep: 24,
    variants: [
      { label: "1 platter", sizeMl: null, price: 34.99, isDefault: true },
    ],
  },
  {
    slug: "family-feast-platter",
    name: "Family Feast Platter",
    tagline: "Feeds 4–5",
    description:
      "Six chicken tikka, two reshmi kebabs, two lamb seekh kebabs and half a tandoori chicken. Built for sharing.",
    category: "tandoor-bbq",
    image: "/images/feast-2.jpg",
    ingredients:
      "Chicken tikka, reshmi kebab, lamb seekh kebab, tandoori chicken, raita, salad",
    allergens: "Milk",
    spice: true,
    prep: 28,
    variants: [
      { label: "1 platter", sizeMl: null, price: 47.99, isDefault: true },
    ],
  },
  {
    slug: "plain-naan",
    name: "Plain Naan",
    tagline: "From the tandoor",
    description:
      "Fluffy, blistered naan baked to order against the clay wall of our tandoor.",
    category: "breads",
    image: "/images/naan-basket.jpg",
    ingredients: "Atta flour, water, yoghurt, yeast, salt",
    allergens: "Gluten, Milk",
    veg: true,
    prep: 6,
    variants: [
      { label: "1 piece", sizeMl: null, price: 2.49, isDefault: true },
    ],
  },
  {
    slug: "butter-naan",
    name: "Butter Naan",
    tagline: "Brushed with ghee",
    description:
      "Our plain naan finished with a generous brush of melted butter.",
    category: "breads",
    image: "/images/naan-dips.jpg",
    ingredients: "Atta flour, water, yoghurt, yeast, butter, salt",
    allergens: "Gluten, Milk",
    veg: true,
    prep: 6,
    variants: [
      { label: "1 piece", sizeMl: null, price: 2.99, isDefault: true },
    ],
  },
  {
    slug: "garlic-naan",
    name: "Garlic Naan",
    tagline: "Garlic butter, coriander",
    description:
      "Naan infused with garlic butter and finished with fresh coriander.",
    category: "breads",
    image: "/images/garlic-naan.jpg",
    ingredients: "Atta flour, water, yoghurt, yeast, garlic, butter, coriander",
    allergens: "Gluten, Milk",
    veg: true,
    featured: true,
    prep: 6,
    variants: [
      { label: "1 piece", sizeMl: null, price: 3.49, isDefault: true },
    ],
    reviews: [
      { name: "Emma W.", rating: 5, comment: "Ordered three. No regrets." },
    ],
  },
  {
    slug: "tandoori-roti",
    name: "Tandoori Roti",
    tagline: "Wholemeal, no oil",
    description:
      "Wholemeal flatbread baked in the tandoor — light, chewy and perfect with nihari.",
    category: "breads",
    image: "/images/tandoor-oven.jpg",
    ingredients: "Wholemeal atta, water, salt",
    allergens: "Gluten",
    veg: true,
    prep: 6,
    variants: [
      { label: "1 piece", sizeMl: null, price: 2.99, isDefault: true },
    ],
  },
  {
    slug: "kb-chicken-burger",
    name: "KB Chicken Burger",
    tagline: "House special sauce",
    description:
      "Crispy chicken patty, KB special sauce, coleslaw, onion and cheese in a toasted bun.",
    category: "burgers",
    image: "/images/burger-classic.jpg",
    ingredients:
      "Chicken patty, burger bun, cheese, coleslaw, onion, KB special sauce",
    allergens: "Gluten, Milk, Egg",
    prep: 12,
    variants: [
      { label: "1 burger", sizeMl: null, price: 16.99, isDefault: true },
    ],
  },
  {
    slug: "kb-beef-burger",
    name: "KB Beef Burger",
    tagline: "Flame-grilled",
    description:
      "Halal beef patty with KB special sauce, pickles, onion and cheese.",
    category: "burgers",
    image: "/images/burger-black.jpg",
    ingredients:
      "Beef patty, burger bun, cheese, pickles, onion, KB special sauce",
    allergens: "Gluten, Milk, Egg",
    prep: 12,
    variants: [
      { label: "1 burger", sizeMl: null, price: 16.99, isDefault: true },
    ],
  },
  {
    slug: "samosa",
    name: "Samosa",
    tagline: "Potato & pea",
    description:
      "Crisp triangular pastries stuffed with spiced potato and peas, served with raita and tamarind chutney.",
    category: "sides",
    image: "/images/samosa.jpg",
    ingredients:
      "Pastry, potato, peas, cumin, coriander, chilli, tamarind chutney, raita",
    allergens: "Gluten, Milk",
    veg: true,
    prep: 8,
    variants: [
      { label: "1 piece", sizeMl: null, price: 5.99, isDefault: true },
      { label: "2 pieces", sizeMl: null, price: 10.99 },
    ],
  },
  {
    slug: "samosa-chaat",
    name: "Samosa Chaat",
    tagline: "Street food classic",
    description:
      "Crushed samosas topped with chickpeas, raita, tamarind and mint chutney, and sev.",
    category: "sides",
    image: "/images/samosa-2.jpg",
    ingredients:
      "Samosa, chickpeas, yoghurt, tamarind chutney, mint chutney, sev, onion",
    allergens: "Gluten, Milk",
    veg: true,
    prep: 10,
    variants: [
      { label: "1 bowl", sizeMl: null, price: 13.99, isDefault: true },
    ],
  },
  {
    slug: "gulab-jamun",
    name: "Gulab Jamun",
    tagline: "4 pieces",
    description:
      "Soft milk dumplings fried until golden and soaked in cardamom sugar syrup.",
    category: "desserts",
    image: "/images/gulab-jamun.jpg",
    ingredients: "Milk powder, flour, ghee, sugar, cardamom, rose water",
    allergens: "Milk, Gluten",
    veg: true,
    prep: 3,
    variants: [
      { label: "4 pieces", sizeMl: null, price: 6.99, isDefault: true },
    ],
  },
  {
    slug: "suji-halwa",
    name: "Suji Halwa",
    tagline: "Made in ghee",
    description:
      "Golden semolina pudding cooked in ghee with almonds, pistachios and raisins.",
    category: "desserts",
    image: "/images/suji-halwa.jpg",
    ingredients:
      "Semolina, ghee, sugar, almonds, pistachios, raisins, cardamom",
    allergens: "Gluten, Milk, tree nuts",
    veg: true,
    prep: 5,
    variants: [{ label: "1 bowl", sizeMl: null, price: 6.99, isDefault: true }],
  },
  {
    slug: "mango-lassi",
    name: "Mango Lassi",
    tagline: "Chilled & thick",
    description:
      "Yoghurt blended with Alphonso mango pulp and a pinch of cardamom.",
    category: "drinks",
    image: "/images/mango-lassi.jpg",
    ingredients: "Yoghurt, mango pulp, milk, sugar, cardamom",
    allergens: "Milk",
    veg: true,
    prep: 3,
    variants: [
      { label: "500 ml", sizeMl: 500, price: 6.99, isDefault: true },
      { label: "1000 ml", sizeMl: 1000, price: 12.99 },
    ],
  },
  {
    slug: "chai",
    name: "Doodh Patti Chai",
    tagline: "Karak, the way it should be",
    description:
      "Strong black tea boiled down with milk, cardamom and cinnamon.",
    category: "drinks",
    image: "/images/chai.jpg",
    ingredients: "Tea leaves, milk, sugar, cardamom, cinnamon",
    allergens: "Milk",
    veg: true,
    prep: 4,
    variants: [{ label: "1 cup", sizeMl: null, price: 5.99, isDefault: true }],
  },
];

const MATERIALS = [
  {
    name: "Chicken (bone-in)",
    sku: "MAT-CHK-BI",
    unit: "kg",
    packQty: 10,
    packCost: 129.9,
    stock: 22,
    reorder: 10,
    supplier: "Sydney Halal Meats",
  },
  {
    name: "Chicken breast",
    sku: "MAT-CHK-BR",
    unit: "kg",
    packQty: 10,
    packCost: 99.0,
    stock: 9,
    reorder: 5,
    supplier: "Sydney Halal Meats",
  },
  {
    name: "Lamb shoulder",
    sku: "MAT-LMB",
    unit: "kg",
    packQty: 8,
    packCost: 159.2,
    stock: 11,
    reorder: 5,
    supplier: "Sydney Halal Meats",
  },
  {
    name: "Goat (bone-in)",
    sku: "MAT-GOAT",
    unit: "kg",
    packQty: 8,
    packCost: 175.2,
    stock: 6,
    reorder: 4,
    supplier: "Sydney Halal Meats",
  },
  {
    name: "Beef shank",
    sku: "MAT-BEEF",
    unit: "kg",
    packQty: 8,
    packCost: 135.2,
    stock: 8,
    reorder: 5,
    supplier: "Sydney Halal Meats",
  },
  {
    name: "Beef mince",
    sku: "MAT-MINCE",
    unit: "kg",
    packQty: 5,
    packCost: 52.5,
    stock: 6,
    reorder: 3,
    supplier: "Sydney Halal Meats",
  },
  {
    name: "Basmati rice (aged)",
    sku: "MAT-RICE",
    unit: "kg",
    packQty: 20,
    packCost: 44.0,
    stock: 38,
    reorder: 15,
    supplier: "Punjab Grocers",
  },
  {
    name: "Atta flour",
    sku: "MAT-ATTA",
    unit: "kg",
    packQty: 25,
    packCost: 30.0,
    stock: 42,
    reorder: 20,
    supplier: "Punjab Grocers",
  },
  {
    name: "Ghee",
    sku: "MAT-GHEE",
    unit: "kg",
    packQty: 5,
    packCost: 47.5,
    stock: 4.2,
    reorder: 2,
    supplier: "Punjab Grocers",
  },
  {
    name: "Cooking oil",
    sku: "MAT-OIL",
    unit: "L",
    packQty: 20,
    packCost: 52.0,
    stock: 15,
    reorder: 8,
    supplier: "Punjab Grocers",
  },
  {
    name: "Yoghurt",
    sku: "MAT-YOG",
    unit: "kg",
    packQty: 5,
    packCost: 18.5,
    stock: 7.5,
    reorder: 3,
    supplier: "Dairy Direct",
  },
  {
    name: "Tomatoes",
    sku: "MAT-TOM",
    unit: "kg",
    packQty: 10,
    packCost: 29.9,
    stock: 16,
    reorder: 8,
    supplier: "Flemington Produce",
  },
  {
    name: "Onions",
    sku: "MAT-ONI",
    unit: "kg",
    packQty: 10,
    packCost: 19.9,
    stock: 18,
    reorder: 8,
    supplier: "Flemington Produce",
  },
  {
    name: "Ginger garlic paste",
    sku: "MAT-GGP",
    unit: "kg",
    packQty: 2,
    packCost: 16.4,
    stock: 2.8,
    reorder: 1,
    supplier: "Punjab Grocers",
  },
  {
    name: "KB masala blend",
    sku: "MAT-MASALA",
    unit: "kg",
    packQty: 2,
    packCost: 38.0,
    stock: 3.4,
    reorder: 1.5,
    supplier: "In-house blend",
  },
  {
    name: "Cream",
    sku: "MAT-CREAM",
    unit: "L",
    packQty: 2,
    packCost: 9.8,
    stock: 3,
    reorder: 1,
    supplier: "Dairy Direct",
  },
  {
    name: "Butter",
    sku: "MAT-BUTTER",
    unit: "kg",
    packQty: 5,
    packCost: 42.5,
    stock: 2.5,
    reorder: 1,
    supplier: "Dairy Direct",
  },
  {
    name: "Green chilli",
    sku: "MAT-CHILLI",
    unit: "kg",
    packQty: 2,
    packCost: 11.0,
    stock: 1.4,
    reorder: 0.5,
    supplier: "Flemington Produce",
  },
  {
    name: "Coriander",
    sku: "MAT-CORI",
    unit: "bunch",
    packQty: 10,
    packCost: 12.0,
    stock: 6,
    reorder: 3,
    supplier: "Flemington Produce",
  },
  {
    name: "Saffron",
    sku: "MAT-SAFF",
    unit: "g",
    packQty: 10,
    packCost: 95.0,
    stock: 8,
    reorder: 3,
    supplier: "Punjab Grocers",
  },
  {
    name: "Black lentils",
    sku: "MAT-DAAL",
    unit: "kg",
    packQty: 10,
    packCost: 28.0,
    stock: 12,
    reorder: 5,
    supplier: "Punjab Grocers",
  },
  {
    name: "Mango pulp",
    sku: "MAT-MANGO",
    unit: "L",
    packQty: 4,
    packCost: 24.0,
    stock: 5,
    reorder: 2,
    supplier: "Dairy Direct",
  },
  {
    name: "Milk powder",
    sku: "MAT-MILK",
    unit: "kg",
    packQty: 1,
    packCost: 18.0,
    stock: 2,
    reorder: 1,
    supplier: "Dairy Direct",
  },
  {
    name: "Sugar",
    sku: "MAT-SUGAR",
    unit: "kg",
    packQty: 10,
    packCost: 13.0,
    stock: 6,
    reorder: 3,
    supplier: "Punjab Grocers",
  },
  {
    name: "Tea leaves",
    sku: "MAT-TEA",
    unit: "kg",
    packQty: 1,
    packCost: 22.0,
    stock: 1.2,
    reorder: 0.5,
    supplier: "Punjab Grocers",
  },
  {
    name: "Burger buns",
    sku: "MAT-BUN",
    unit: "each",
    packQty: 24,
    packCost: 12.0,
    stock: 36,
    reorder: 24,
    supplier: "Bakehouse",
  },
  {
    name: "Lettuce",
    sku: "MAT-LETTUCE",
    unit: "kg",
    packQty: 3,
    packCost: 21.0,
    stock: 2.4,
    reorder: 1,
    supplier: "Flemington Produce",
  },
  {
    name: "Samosa pastry",
    sku: "MAT-PASTRY",
    unit: "each",
    packQty: 50,
    packCost: 18.0,
    stock: 44,
    reorder: 20,
    supplier: "Punjab Grocers",
  },
  {
    name: "Potatoes",
    sku: "MAT-POTATO",
    unit: "kg",
    packQty: 10,
    packCost: 16.0,
    stock: 21,
    reorder: 10,
    supplier: "Flemington Produce",
  },
  {
    name: "Gulab jamun mix",
    sku: "MAT-GULAB",
    unit: "kg",
    packQty: 2,
    packCost: 22.0,
    stock: 1.6,
    reorder: 1,
    supplier: "Punjab Grocers",
  },
  {
    name: "Semolina",
    sku: "MAT-SUJI",
    unit: "kg",
    packQty: 5,
    packCost: 9.5,
    stock: 3.2,
    reorder: 1.5,
    supplier: "Punjab Grocers",
  },
  {
    name: "Almonds & pistachios",
    sku: "MAT-NUTS",
    unit: "kg",
    packQty: 2,
    packCost: 46.0,
    stock: 1.1,
    reorder: 0.8,
    supplier: "Punjab Grocers",
  },
  {
    name: "Chicken patty",
    sku: "MAT-PATTY-C",
    unit: "each",
    packQty: 20,
    packCost: 26.0,
    stock: 28,
    reorder: 20,
    supplier: "Sydney Halal Meats",
  },
  {
    name: "Beef patty",
    sku: "MAT-PATTY-B",
    unit: "each",
    packQty: 20,
    packCost: 30.0,
    stock: 22,
    reorder: 20,
    supplier: "Sydney Halal Meats",
  },
];

type RecipeSeed = {
  name: string;
  menuItemSlug?: string;
  outputKind: "menu_item" | "batch";
  outputQty: number;
  outputUnit: string;
  prepMinutes: number;
  notes: string;
  lines: [string, number][];
};

const RECIPES: RecipeSeed[] = [
  {
    name: "Chicken Biryani — 500 ml portion",
    menuItemSlug: "chicken-biryani",
    outputKind: "menu_item",
    outputQty: 1,
    outputUnit: "portion",
    prepMinutes: 18,
    notes: "Standard 500 ml tub. Double for the 1 L tub.",
    lines: [
      ["Chicken (bone-in)", 0.18],
      ["Basmati rice (aged)", 0.16],
      ["Ghee", 0.02],
      ["Yoghurt", 0.04],
      ["Onions", 0.09],
      ["Tomatoes", 0.05],
      ["KB masala blend", 0.012],
      ["Saffron", 0.03],
      ["Cooking oil", 0.01],
      ["Coriander", 0.05],
    ],
  },
  {
    name: "Lamb Dum Biryani — 500 ml portion",
    menuItemSlug: "lamb-dum-biryani",
    outputKind: "menu_item",
    outputQty: 1,
    outputUnit: "portion",
    prepMinutes: 20,
    notes: "Lamb shoulder on the bone, marinated overnight.",
    lines: [
      ["Lamb shoulder", 0.18],
      ["Basmati rice (aged)", 0.16],
      ["Ghee", 0.02],
      ["Yoghurt", 0.05],
      ["Onions", 0.09],
      ["KB masala blend", 0.014],
      ["Saffron", 0.03],
    ],
  },
  {
    name: "Butter Chicken — 500 ml portion",
    menuItemSlug: "butter-chicken",
    outputKind: "menu_item",
    outputQty: 1,
    outputUnit: "portion",
    prepMinutes: 16,
    notes: "Cashew paste is made in-house each morning.",
    lines: [
      ["Chicken breast", 0.17],
      ["Tomatoes", 0.12],
      ["Cream", 0.06],
      ["Butter", 0.02],
      ["Yoghurt", 0.03],
      ["KB masala blend", 0.012],
      ["Ginger garlic paste", 0.015],
    ],
  },
  {
    name: "Chicken Karahi — 500 ml portion",
    menuItemSlug: "chicken-karahi",
    outputKind: "menu_item",
    outputQty: 1,
    outputUnit: "portion",
    prepMinutes: 18,
    notes: "Cooked to order in the karahi.",
    lines: [
      ["Chicken (bone-in)", 0.2],
      ["Tomatoes", 0.15],
      ["Onions", 0.06],
      ["Cooking oil", 0.03],
      ["KB masala blend", 0.015],
      ["Green chilli", 0.01],
      ["Ginger garlic paste", 0.015],
      ["Coriander", 0.05],
    ],
  },
  {
    name: "Beef Nihari — 500 ml portion",
    menuItemSlug: "beef-nihari",
    outputKind: "menu_item",
    outputQty: 1,
    outputUnit: "portion",
    prepMinutes: 12,
    notes: "Braise is started the night before.",
    lines: [
      ["Beef shank", 0.2],
      ["KB masala blend", 0.02],
      ["Onions", 0.05],
      ["Cooking oil", 0.03],
      ["Ginger garlic paste", 0.02],
    ],
  },
  {
    name: "Daal Makhni — 500 ml portion",
    menuItemSlug: "daal-makhni",
    outputKind: "menu_item",
    outputQty: 1,
    outputUnit: "portion",
    prepMinutes: 12,
    notes: "Lentils soaked overnight, finished with butter and cream.",
    lines: [
      ["Black lentils", 0.12],
      ["Butter", 0.02],
      ["Cream", 0.04],
      ["Tomatoes", 0.08],
      ["Onions", 0.04],
    ],
  },
  {
    name: "Naan — 50 piece batch",
    menuItemSlug: "plain-naan",
    outputKind: "batch",
    outputQty: 50,
    outputUnit: "pieces",
    prepMinutes: 90,
    notes: "Dough rests 45 minutes. One batch covers a lunch service.",
    lines: [
      ["Atta flour", 6],
      ["Yoghurt", 0.5],
      ["Ghee", 0.3],
      ["Sugar", 0.1],
      ["Milk powder", 0.15],
    ],
  },
  {
    name: "Tandoori Roti — 60 piece batch",
    menuItemSlug: "tandoori-roti",
    outputKind: "batch",
    outputQty: 60,
    outputUnit: "pieces",
    prepMinutes: 75,
    notes: "Wholemeal, no oil in the dough.",
    lines: [
      ["Atta flour", 5],
      ["Cooking oil", 0.2],
    ],
  },
  {
    name: "Seekh Kebab — 40 piece batch",
    menuItemSlug: "seekh-kebab",
    outputKind: "batch",
    outputQty: 40,
    outputUnit: "pieces",
    prepMinutes: 60,
    notes: "Mince by hand for the right texture.",
    lines: [
      ["Beef mince", 4],
      ["Onions", 0.8],
      ["KB masala blend", 0.2],
      ["Ginger garlic paste", 0.1],
      ["Coriander", 0.5],
    ],
  },
  {
    name: "Samosa — 50 piece batch",
    menuItemSlug: "samosa",
    outputKind: "batch",
    outputQty: 50,
    outputUnit: "pieces",
    prepMinutes: 70,
    notes: "Filled and folded by hand each morning.",
    lines: [
      ["Samosa pastry", 50],
      ["Potatoes", 2.5],
      ["KB masala blend", 0.15],
      ["Cooking oil", 0.5],
    ],
  },
];

const HOLIDAYS = [
  ["2026-01-01", "New Year's Day", 15],
  ["2026-01-26", "Australia Day", 10],
  ["2026-04-03", "Good Friday", 15],
  ["2026-04-04", "Easter Saturday", 10],
  ["2026-04-06", "Easter Monday", 10],
  ["2026-04-25", "Anzac Day", 10],
  ["2026-06-08", "King's Birthday", 10],
  ["2026-10-05", "NSW Labour Day", 10],
  ["2026-12-25", "Christmas Day", 15],
  ["2026-12-26", "Boxing Day", 10],
  ["2027-01-01", "New Year's Day", 15],
  ["2027-01-26", "Australia Day", 10],
];

/**
 * Seed a brand-new database with the menu, staff, tables, pricing, materials,
 * recipes, release notes and demo orders. Only runs when `menu_items` is empty,
 * and takes a Postgres advisory lock first so two cold-starting instances cannot
 * both seed.
 */
export async function seedDatabase(db: Database): Promise<{ seeded: boolean }> {
  const existing = await db.maybeOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM menu_items",
  );
  if ((existing?.c ?? 0) > 0) return { seeded: false };

  return db.transaction(async (tx) => {
    // Re-check inside the lock: another instance may have won the race.
    await tx.query("SELECT pg_advisory_xact_lock(918273645)");
    const again = await tx.maybeOne<{ c: number }>(
      "SELECT COUNT(*) AS c FROM menu_items",
    );
    if ((again?.c ?? 0) > 0) return { seeded: false };

    await seedSettings(tx);
    await seedStaff(tx);
    await seedCustomers(tx);
    await seedTables(tx);
    await seedPricing(tx);
    await seedCategoriesAndMenu(tx);
    await seedMaterialsAndRecipes(tx);
    await seedWhatsNew(tx);
    await seedProductionAndOrders(tx);
    await seedPlatformExpansion(tx);
    await seedLahoreAndWhatsApp(tx);
    return { seeded: true };
  });
}

async function seedSettings(db: Database) {
  const rows = Object.entries(DEFAULT_SETTINGS);
  for (const [key, value] of rows) {
    await db.query(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  }
  await db.query(
    "INSERT INTO settings (key, value) VALUES ('restaurant_name', 'Khan Baba Restaurant') ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
}

async function seedStaff(db: Database) {
  const password = hashPassword("KhanBaba2026!");
  const staff: [string, string, string][] = [
    ["Raheel Atta", "admin@khanbaba.com.au", "admin"],
    ["Sana Malik", "manager@khanbaba.com.au", "manager"],
    ["Imran Shah", "counter@khanbaba.com.au", "counter"],
    ["Chef Bilal", "kitchen@khanbaba.com.au", "kitchen"],
    ["Hamza Ali", "delivery@khanbaba.com.au", "delivery"],
  ];
  for (const [name, email, role] of staff) {
    await db.query(
      "INSERT INTO staff (name, email, role, password_hash) VALUES ($1, $2, $3, $4)",
      [name, email, role, password],
    );
  }
}

/**
 * Demo customer accounts, so the portal has a face to sign in with and the
 * seeded orders have somewhere to hang their history. Password for both is the
 * same demo password as the staff logins.
 */
async function seedCustomers(db: Database) {
  const password = hashPassword("KhanBaba2026!");
  const customers: [string, string, string, string, string, string][] = [
    ["Ayesha Khan", "ayesha@example.com", "0412 345 678", "12/48 Pirrama Road", "Pyrmont", "2009"],
    ["Daniel Mercer", "daniel@example.com", "0433 987 654", "25 Harris Street", "Pyrmont", "2009"],
  ];
  for (const [name, email, phone, address, suburb, postcode] of customers) {
    const id = await db.insert(
      `INSERT INTO customers (name, email, phone, password_hash, address, suburb, postcode, guest, last_order_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, now()) RETURNING id`,
      [name, email, phone, password, address, suburb, postcode],
    );
    await db.query(
      `INSERT INTO customer_activity (customer_id, kind, detail) VALUES ($1, 'signup', 'Account created')`,
      [id],
    );
  }
}

async function seedTables(db: Database) {
  const zones = ["Ground floor", "Window", "Mezzanine"];
  for (let i = 1; i <= 12; i++) {
    const code = `T${String(i).padStart(2, "0")}`;
    await db.query(
      "INSERT INTO dining_tables (code, name, zone, seats) VALUES ($1, $2, $3, $4)",
      [
        code,
        `Table ${i}`,
        zones[i % zones.length],
        i <= 2 ? 2 : i <= 8 ? 4 : 6,
      ],
    );
  }
}

async function seedPricing(db: Database) {
  const rules: (string | number | null)[][] = [
    [
      "weekend_surcharge",
      "Weekend surcharge",
      "weekend",
      "percent",
      5,
      "all",
      "0,6",
      null,
      null,
      0,
      "5% applies to Saturday and Sunday orders.",
      10,
    ],
    [
      "public_holiday_surcharge",
      "Public holiday surcharge",
      "public_holiday",
      "percent",
      10,
      "all",
      null,
      null,
      null,
      0,
      "10% applies on dates in the public holiday calendar (a holiday replaces the weekend rate).",
      5,
    ],
    [
      "priority_standard",
      "Priority preparation",
      "priority",
      "flat",
      2.5,
      "delivery,pickup",
      null,
      null,
      null,
      0,
      "Optional: jump the kitchen queue. Never charged to dine-in or table guests.",
      50,
    ],
    [
      "priority_peak_lunch",
      "Peak hour priority — lunch",
      "priority",
      "flat",
      4.5,
      "delivery,pickup",
      "1,2,3,4,5",
      "12:00",
      "14:00",
      0,
      "Lunch peak window, Monday to Friday.",
      40,
    ],
    [
      "priority_peak_dinner",
      "Peak hour priority — dinner",
      "priority",
      "flat",
      4.5,
      "delivery,pickup",
      "4,5,6",
      "18:00",
      "21:30",
      0,
      "Thursday to Saturday dinner peak.",
      40,
    ],
  ];
  for (const rule of rules) {
    await db.query(
      `INSERT INTO pricing_rules (code, label, kind, calc, value, applies_to, days, start_time, end_time, min_subtotal_cents, description, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      rule,
    );
  }

  for (const [date, name, percent] of HOLIDAYS) {
    await db.query(
      "INSERT INTO holidays (date, name, surcharge_percent) VALUES ($1, $2, $3) ON CONFLICT (date) DO NOTHING",
      [date, name, percent],
    );
  }
}

async function seedCategoriesAndMenu(db: Database) {
  const categoryIds = new Map<string, number>();
  for (const category of CATEGORIES) {
    const id = await db.insert(
      "INSERT INTO categories (slug, name, description, sort_order) VALUES ($1, $2, $3, $4) RETURNING id",
      [category.slug, category.name, category.description, category.sort],
    );
    categoryIds.set(category.slug, id);
  }

  for (const [index, item] of ITEMS.entries()) {
    const categoryId = categoryIds.get(item.category) ?? null;
    const itemId = await db.insert(
      `INSERT INTO menu_items (slug, name, tagline, description, category_id, image, ingredients, allergens,
        spice_levels, prep_minutes, is_veg, is_available, is_featured, is_new, published, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, $12, $13, TRUE, $14)
       RETURNING id`,
      [
        item.slug,
        item.name,
        item.tagline,
        item.description,
        categoryId,
        item.image,
        item.ingredients,
        item.allergens,
        item.spice ? "blend,mild,hot,extra_hot" : "",
        item.prep,
        Boolean(item.veg),
        Boolean(item.featured),
        Boolean(item.isNew),
        index,
      ],
    );

    for (const [variantIndex, variant] of item.variants.entries()) {
      await db.query(
        `INSERT INTO item_variants (item_id, label, size_ml, price_cents, is_default, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          itemId,
          variant.label,
          variant.sizeMl,
          cents(variant.price),
          Boolean(variant.isDefault || variantIndex === 0),
          variantIndex,
        ],
      );
    }

    for (const [reviewIndex, review] of (item.reviews ?? []).entries()) {
      await db.query(
        `INSERT INTO reviews (item_id, customer_name, rating, comment, status, created_at)
         VALUES ($1, $2, $3, $4, 'published', now() - ($5 || ' days')::interval)`,
        [itemId, review.name, review.rating, review.comment, reviewIndex + 2],
      );
    }
  }
}

async function seedMaterialsAndRecipes(db: Database) {
  const materialIds = new Map<string, number>();
  for (const material of MATERIALS) {
    const id = await db.insert(
      `INSERT INTO materials (name, sku, unit, pack_qty, pack_cost_cents, stock_qty, reorder_level, supplier)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        material.name,
        material.sku,
        material.unit,
        material.packQty,
        cents(material.packCost),
        material.stock,
        material.reorder,
        material.supplier,
      ],
    );
    materialIds.set(material.name, id);
  }

  for (const recipe of RECIPES) {
    const menuItem = recipe.menuItemSlug
      ? await db.maybeOne<{ id: number }>(
          "SELECT id FROM menu_items WHERE slug = $1",
          [recipe.menuItemSlug],
        )
      : null;
    const recipeId = await db.insert(
      `INSERT INTO recipes (name, output_kind, menu_item_id, output_qty, output_unit, prep_minutes, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        recipe.name,
        recipe.outputKind,
        menuItem?.id ?? null,
        recipe.outputQty,
        recipe.outputUnit,
        recipe.prepMinutes,
        recipe.notes,
      ],
    );
    for (const [materialName, qty] of recipe.lines) {
      const materialId = materialIds.get(materialName);
      if (!materialId) continue;
      const unit = MATERIALS.find((m) => m.name === materialName)?.unit ?? "kg";
      await db.query(
        "INSERT INTO recipe_lines (recipe_id, material_id, qty, unit) VALUES ($1, $2, $3, $4)",
        [recipeId, materialId, qty, unit],
      );
    }
  }
}

async function seedWhatsNew(db: Database) {
  const prUrl = "https://github.com/Raheelatta1984/KhanBabaResturants/pull/1";
  const entries: [string, string, string, string, number, string][] = [
    [
      "Order online, your way",
      "Delivery, click & collect and dine-in from one dynamic menu — with 500 ml and 1000 ml containers for biryani and curries.",
      "The static Wix menu is now a live catalogue. Every dish is configurable: choose a container size, pick your heat level and add kitchen notes. Prices, ingredients, allergens and preparation times all come from the database, so the menu can change without a deploy.",
      "feature",
      1,
      "-3 hours",
    ],
    [
      "Uber Direct delivery quotes",
      "Live courier quotes at checkout, with the fee shown before you pay.",
      "We request a delivery quote from Uber Direct for your address while you check out, apply the restaurant's service margin and show the final fee in the order summary. The delivery team signs off the courier request from their own portal once the food is packed.",
      "feature",
      1,
      "-3 hours",
    ],
    [
      "Kitchen and delivery portals",
      "Counter → kitchen → courier, with every hand-off tracked.",
      "Orders accepted at the counter appear instantly on the kitchen display. Items tick off as they are prepared, the ticket is bumped when packed, and the delivery coordinator triggers the courier request. Customers see the same progress bar.",
      "portal",
      1,
      "-3 hours",
    ],
    [
      "Table QR ordering with live progress",
      "Scan the QR at your table, order in seconds and track preparation.",
      "Each table has its own QR code and ordering page. Table orders are confirmed by the counter, prepared in the kitchen and can be paid online or at the counter on the way out. Guests follow a live completion percentage from confirmation to serve.",
      "feature",
      1,
      "-2 hours",
    ],
    [
      "Manufacturing & material costing",
      "Every naan, roti and curry batch carries its material cost.",
      "Production runs draw down stock and lodge a cost against every material consumed — flour, ghee, chicken, masala and more. The admin dashboard shows cost per portion against menu price, so margins are visible in real time.",
      "feature",
      1,
      "-2 hours",
    ],
    [
      "Weekend, public holiday and peak pricing",
      "Rules-based surcharges, fully configurable.",
      "Maintain a calendar of NSW public holidays and let pricing rules apply weekend or holiday surcharges automatically. Priority preparation can be offered in peak windows for delivery and pick-up only — never to table guests.",
      "improvement",
      1,
      "-1 hours",
    ],
    [
      "Dish photos in your own Google Drive",
      "Upload dish photos to Google Drive or Vercel Blob — both keep working after a redeploy.",
      "Photos are no longer saved on the server's temporary disk. Connect a Vercel Blob store or a Google Drive folder (shared with the app's service account) and every upload is stored durably, with the URL saved on the dish so the menu can display it anywhere.",
      "improvement",
      1,
      "-1 hours",
    ],
    [
      "New dish onboarding with video",
      "Upload photos, paste a YouTube link, publish when ready.",
      "Add a dish with images, ingredients, allergens, spice levels and container sizes. A YouTube link plays inline in the dish page using the privacy-enhanced player — no third-party widget or tracking script on the site.",
      "improvement",
      1,
      "-1 hours",
    ],
    [
      "One database for every server instance",
      "The platform now runs on Postgres instead of a local SQL file.",
      "Orders, menu changes, stock and cost postings are stored in a single durable Postgres database shared by every server instance. Storage used to be per-instance and reset on redeploy; now a redeploy, a cold start or a second server sees exactly the same data. The schema and demo data are created automatically the first time the app connects — no migration step — and /api/health reports the database it is talking to plus live row counts.",
      "ops",
      1,
      "0 minutes",
    ],
    [
      "Accounts and a tracking link for every order",
      "Sign in (or don't) — your order history, saved address and a private tracking link now travel with you.",
      "Ordering never needed a login and still doesn't: the menu, table QR codes, counter walk-ins and the tracking link all work signed out. What is new is the option to keep it. Create an account and the checkout is prefilled, past orders are listed with a one-tap reorder, and every order you place appears in one place. Each order also gets a private tracking link (/t/…) that is unguessable rather than derived from the order code, with copy, share, SMS and email buttons — and /track finds an order from either a code or a pasted link. Guests who ordered before signing up keep their history: signing up with the same email attaches it, and the counter can text a one-time link that claims the order into an account. The counter also gained a customer search, so a phone call can be answered without an order code.",
      "feature",
      1,
      "0 minutes",
    ],
    [
      "Moved to Supabase: database and photos",
      "The platform's database and dish photography now live in Supabase, in Sydney.",
      "The app had been written against Neon while the project had already moved to Supabase, so the deployment had a connection string it could not use and every page fell back to the setup screen. The data layer now speaks plain Postgres over Supabase's connection pooler (transaction mode, port 6543), with the connection string resolved from DATABASE_URL — blanks now count as missing rather than as configured — and the schema is still created automatically on the first request. Dish photos upload to the menu-photos bucket in Supabase Storage and are served from its CDN, so nothing depends on a Vercel function's temporary disk. /api/health reports which project, which pooler mode and which media driver are in use.",
      "fix",
      1,
      "0 minutes",
    ],
    [
      "Users & access: roles, password resets and going live",
      "Manage every login from the admin console, and retire the demo credentials in one step.",
      "Staff & access is now Users & access. Edit a team member's name, sign-in email and role, reset a forgotten password with a generated one, disable or delete an account, and do the same for customer logins. Changes apply on the person's next click: a disabled account or a reset password signs them out straight away rather than when the cookie expires. Everyone can change their own password from the shield icon in the portal bar. Managers run the team but cannot create, edit or become administrators, and the last active administrator can never be removed. Before going live, 'Remove demo credentials' sets a real password on your account, disables every other account still on the demo password, removes the demo customer logins and stops the sign-in page printing them.",
      "portal",
      1,
      "0 minutes",
    ],
    [
      "This release feed",
      "What's New is built into the site.",
      "Every pull request can add a note here. The feed is published from the admin console, and the scripts/whats-new.mjs helper drafts entries straight from your git history.",
      "ops",
      1,
      "-30 minutes",
    ],
  ];

  for (const [title, summary, body, category, _, age] of entries) {
    // `age` arrives as "-3 hours" — Postgres wants an interval literal.
    await db.query(
      `INSERT INTO whats_new (title, summary, body, category, version, pr_number, pr_url, pinned, published_at)
       VALUES ($1, $2, $3, $4, '1.0.0', 1, $5, FALSE, now() - $6::interval)`,
      [title, summary, body, category, prUrl, age.replace("-", "")],
    );
  }
  await db.query(
    "UPDATE whats_new SET pinned = TRUE WHERE title = 'Order online, your way'",
  );
}

/**
 * A stable tracking token for a seeded order, so the demo tracking link is
 * predictable (`/t/demo-kb-demo01-token`) instead of random on every seed.
 */
function demoTrackingToken(code: string): string {
  return `demo-${code.toLowerCase()}-token`;
}

async function seedProductionAndOrders(db: Database) {
  const naanRecipe = await db.one<{ id: number }>(
    "SELECT id FROM recipes WHERE name LIKE 'Naan —%'",
  );
  const kebabRecipe = await db.one<{ id: number }>(
    "SELECT id FROM recipes WHERE name LIKE 'Seekh Kebab%'",
  );
  const rotiRecipe = await db.one<{ id: number }>(
    "SELECT id FROM recipes WHERE name LIKE 'Tandoori Roti%'",
  );

  const naanBatch = await startBatch(db, {
    recipeId: naanRecipe.id,
    plannedQty: 50,
    actor: "Chef Bilal",
    notes: "Lunch service",
  });
  await completeBatch(db, naanBatch.id, "Chef Bilal");

  const kebabBatch = await startBatch(db, {
    recipeId: kebabRecipe.id,
    plannedQty: 40,
    actor: "Chef Bilal",
    notes: "Friday dinner prep",
  });
  await completeBatch(db, kebabBatch.id, "Chef Bilal");

  const rotiBatch = await startBatch(db, {
    recipeId: rotiRecipe.id,
    plannedQty: 60,
    actor: "Chef Bilal",
    notes: "Weekend brunch",
  });
  await db.query(
    "UPDATE production_batches SET started_at = now() - interval '1 hour' WHERE id = $1",
    [rotiBatch.id],
  );

  const table = await db.one<{ id: number }>(
    "SELECT id FROM dining_tables WHERE code = 'T04'",
  );
  const pick = (slugSql: string) =>
    db.one<{
      item_id: number;
      name: string;
      variant_id: number;
      label: string;
      size_ml: number | null;
      price_cents: number;
    }>(
      `SELECT mi.id AS item_id, mi.name, iv.id AS variant_id, iv.label, iv.size_ml, iv.price_cents
       FROM menu_items mi JOIN item_variants iv ON iv.item_id = mi.id
       WHERE ${slugSql} ORDER BY iv.sort_order LIMIT 1`,
    );
  const biryani = await pick(
    "mi.slug = 'chicken-biryani' AND iv.size_ml = 500",
  );
  const butterChicken = await pick(
    "mi.slug = 'butter-chicken' AND iv.size_ml = 500",
  );
  const naan = await pick("mi.slug = 'garlic-naan'");
  const lassi = await pick("mi.slug = 'mango-lassi' AND iv.size_ml = 500");

  type DemoItem = {
    row: typeof biryani;
    qty: number;
    spice: string;
    state: string;
  };

  type DemoOrder = {
    code: string;
    channel: string;
    tableId?: number;
    name: string;
    phone: string;
    address?: string;
    suburb?: string;
    postcode?: string;
    status: string;
    progress: number;
    paymentMethod: string;
    paymentStatus: string;
    paymentRef?: string;
    items: DemoItem[];
    priority?: boolean;
    priorityFee?: number;
    deliveryFee?: number;
    deliveryCost?: number;
    surcharge?: number;
    ageMinutes: number;
    events: [string, string, string][];
  };

  const demos: DemoOrder[] = [
    {
      code: "KB-DEMO01",
      channel: "delivery",
      name: "Ayesha Khan",
      phone: "0412 345 678",
      address: "12/48 Pirrama Road",
      suburb: "Pyrmont",
      postcode: "2009",
      status: "pending_confirm",
      progress: 5,
      paymentMethod: "online",
      paymentStatus: "paid",
      paymentRef: "sim_pi_demo01",
      priority: true,
      priorityFee: 250,
      deliveryFee: 649,
      deliveryCost: 560,
      ageMinutes: 4,
      items: [
        { row: biryani, qty: 1, spice: "hot", state: "queued" },
        { row: naan, qty: 2, spice: "", state: "queued" },
        { row: lassi, qty: 1, spice: "", state: "queued" },
      ],
      events: [["created", "Order placed — delivery", "customer"]],
    },
    {
      code: "KB-DEMO02",
      channel: "table",
      tableId: table.id,
      name: "Table 4",
      phone: "0400 111 222",
      status: "preparing",
      progress: 47,
      paymentMethod: "online",
      paymentStatus: "paid",
      paymentRef: "sim_pi_demo02",
      ageMinutes: 14,
      items: [
        { row: butterChicken, qty: 2, spice: "mild", state: "ready" },
        { row: naan, qty: 4, spice: "", state: "preparing" },
      ],
      events: [
        ["created", "Order placed — table order", "customer"],
        [
          "confirmed",
          "Order accepted by the counter — sent to the kitchen display",
          "Imran Shah",
        ],
        ["kitchen_started", "Kitchen started preparation", "Chef Bilal"],
        [
          "item_ready",
          "Butter Chicken (500 ml) is ready — 1/2 items complete",
          "Chef Bilal",
        ],
      ],
    },
    {
      code: "KB-DEMO03",
      channel: "pickup",
      name: "Daniel Mercer",
      phone: "0433 987 654",
      status: "awaiting_collection",
      progress: 88,
      paymentMethod: "online",
      paymentStatus: "paid",
      paymentRef: "sim_pi_demo03",
      ageMinutes: 26,
      items: [{ row: biryani, qty: 2, spice: "extra_hot", state: "ready" }],
      events: [
        ["created", "Order placed — click & collect", "customer"],
        [
          "confirmed",
          "Order accepted by the counter — sent to the kitchen display",
          "Imran Shah",
        ],
        ["kitchen_started", "Kitchen started preparation", "Chef Bilal"],
        ["ready", "Ready for collection at the counter", "Chef Bilal"],
      ],
    },
    {
      code: "KB-DEMO04",
      channel: "delivery",
      name: "Priya Shah",
      phone: "0455 222 111",
      address: "803/1 Darling Drive",
      suburb: "Darling Harbour",
      postcode: "2000",
      status: "ready",
      progress: 85,
      paymentMethod: "online",
      paymentStatus: "paid",
      paymentRef: "sim_pi_demo04",
      deliveryFee: 699,
      deliveryCost: 605,
      ageMinutes: 22,
      items: [
        { row: butterChicken, qty: 1, spice: "hot", state: "ready" },
        { row: biryani, qty: 1, spice: "mild", state: "ready" },
        { row: naan, qty: 3, spice: "", state: "ready" },
      ],
      events: [
        ["created", "Order placed — delivery", "customer"],
        [
          "confirmed",
          "Order accepted by the counter — sent to the kitchen display",
          "Imran Shah",
        ],
        ["kitchen_started", "Kitchen started preparation", "Chef Bilal"],
        [
          "ready",
          "Packed and ready — waiting for the delivery coordinator",
          "Chef Bilal",
        ],
      ],
    },
    {
      code: "KB-DEMO05",
      channel: "dine_in",
      name: "Walk-in — 2 guests",
      phone: "",
      status: "pending_confirm",
      progress: 5,
      paymentMethod: "counter",
      paymentStatus: "unpaid",
      ageMinutes: 2,
      items: [
        { row: butterChicken, qty: 1, spice: "blend", state: "queued" },
        { row: naan, qty: 2, spice: "", state: "queued" },
      ],
      events: [["created", "Order placed — dine in", "counter"]],
    },
  ];

  for (const demo of demos) {
    const subtotal = demo.items.reduce(
      (sum, item) => sum + item.row.price_cents * item.qty,
      0,
    );
    const surcharge = demo.surcharge ?? 0;
    const priorityFee = demo.priorityFee ?? 0;
    const deliveryFee = demo.deliveryFee ?? 0;
    const total = subtotal + surcharge + priorityFee + deliveryFee;
    const isReady = [
      "ready",
      "awaiting_collection",
      "out_for_delivery",
      "completed",
    ].includes(demo.status);

    const orderId = await db.insert(
      `INSERT INTO orders (code, tracking_token, channel, table_id, customer_name, phone, email, address, suburb, postcode, notes,
        subtotal_cents, surcharge_cents, surcharge_detail, priority, priority_fee_cents, delivery_fee_cents,
        delivery_cost_cents, total_cents, payment_method, payment_status, payment_ref, status, progress,
        created_at, updated_at, confirmed_at, kitchen_started_at, ready_at, dispatched_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, NULL, $10, $11, '[]', $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, now() - $22::interval, now() - $22::interval,
        now() - $23::interval, now() - $24::interval, now() - $25::interval, NULL)
       RETURNING id`,
      [
        demo.code,
        demoTrackingToken(demo.code),
        demo.channel,
        demo.tableId ?? null,
        demo.name,
        demo.phone || null,
        demo.address ?? null,
        demo.suburb ?? null,
        demo.postcode ?? null,
        subtotal,
        surcharge,
        Boolean(demo.priority),
        priorityFee,
        deliveryFee,
        demo.deliveryCost ?? 0,
        total,
        demo.paymentMethod,
        demo.paymentStatus,
        demo.paymentRef ?? null,
        demo.status,
        demo.progress,
        `${demo.ageMinutes} minutes`,
        demo.status === "pending_confirm"
          ? null
          : `${Math.max(1, demo.ageMinutes - 2)} minutes`,
        demo.status === "preparing" || isReady
          ? `${Math.max(1, demo.ageMinutes - 3)} minutes`
          : null,
        isReady ? `${Math.max(1, demo.ageMinutes - 8)} minutes` : null,
      ],
    );

    for (const item of demo.items) {
      await db.query(
        `INSERT INTO order_items (order_id, item_id, variant_id, name, variant_label, size_ml, spice_level, qty,
          unit_price_cents, line_total_cents, notes, prep_state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11)`,
        [
          orderId,
          item.row.item_id,
          item.row.variant_id,
          item.row.name,
          item.row.label,
          item.row.size_ml,
          item.spice || null,
          item.qty,
          item.row.price_cents,
          item.row.price_cents * item.qty,
          item.state,
        ],
      );
    }

    for (const [index, event] of demo.events.entries()) {
      await db.query(
        `INSERT INTO order_events (order_id, type, message, actor, progress, created_at)
         VALUES ($1, $2, $3, $4, NULL, now() - $5::interval)`,
        [
          orderId,
          event[0],
          event[1],
          event[2],
          `${Math.max(1, demo.ageMinutes - index * 3)} minutes`,
        ],
      );
    }

    await db.query(
      `INSERT INTO payments (order_id, provider, intent_id, amount_cents, status, method, last4, paid_at)
       VALUES ($1, 'simulated', $2, $3, 'paid', 'card', '4242', now())`,
      [orderId, demo.paymentRef ?? `sim_pi_${demo.code}`, total],
    );

    if (demo.channel === "delivery") {
      await db.query(
        `INSERT INTO delivery_jobs (order_id, provider, provider_quote_id, cost_cents, customer_fee_cents, markup_cents,
          status, eta_minutes, quote_json, created_at)
         VALUES ($1, 'simulated', $2, $3, $4, $5, 'quoted', 32, '{}', now() - $6::interval)`,
        [
          orderId,
          `sim_q_${demo.code.toLowerCase()}`,
          demo.deliveryCost ?? 0,
          deliveryFee,
          deliveryFee - (demo.deliveryCost ?? 0),
          `${demo.ageMinutes} minutes`,
        ],
      );
    }
  }

  // Attach the demo orders to the demo customer accounts, so signing in as
  // ayesha@example.com shows a real order history rather than an empty page.
  await db.query(
    `UPDATE orders o SET customer_id = c.id
     FROM customers c
     WHERE o.customer_id IS NULL AND lower(o.customer_name) = lower(c.name)`,
  );
  await db.query(
    `UPDATE customers c SET last_order_at = latest.created_at
     FROM (SELECT customer_id, MAX(created_at) AS created_at FROM orders
           WHERE customer_id IS NOT NULL GROUP BY customer_id) latest
     WHERE latest.customer_id = c.id`,
  );

  // A completed delivery from earlier today, so reports have history.
  const completedId = await db.insert(
    `INSERT INTO orders (code, tracking_token, channel, customer_name, phone, address, suburb, postcode, subtotal_cents, surcharge_cents,
      surcharge_detail, priority, priority_fee_cents, delivery_fee_cents, delivery_cost_cents, total_cents,
      payment_method, payment_status, payment_ref, status, progress, created_at, updated_at, confirmed_at,
      kitchen_started_at, ready_at, dispatched_at, completed_at)
     VALUES ('KB-DEMO06', $1, 'delivery', 'Michael Rourke', '0466 555 444', '25 Harris Street', 'Pyrmont', '2009',
      4198, 0, '[]', FALSE, 0, 649, 555, 4847, 'online', 'paid', 'sim_pi_demo06', 'completed', 100,
      now() - interval '4 hours', now() - interval '3 hours', now() - interval '4 hours', now() - interval '4 hours',
      now() - interval '3 hours', now() - interval '3 hours', now() - interval '2 hours')
     RETURNING id`,
    [demoTrackingToken("KB-DEMO06")],
  );
  await db.query(
    `INSERT INTO order_items (order_id, item_id, variant_id, name, variant_label, size_ml, spice_level, qty,
      unit_price_cents, line_total_cents, prep_state)
     VALUES ($1, $2, $3, 'Family Feast Platter', '1 platter', NULL, 'hot', 1, 4799, 4799, 'ready')`,
    [completedId, butterChicken.item_id, butterChicken.variant_id],
  );
  await db.query(
    `INSERT INTO payments (order_id, provider, intent_id, amount_cents, status, method, last4, paid_at)
     VALUES ($1, 'simulated', 'sim_pi_demo06', 4847, 'paid', 'card', '4242', now() - interval '3 hours')`,
    [completedId],
  );
  await db.query(
    `INSERT INTO delivery_jobs (order_id, provider, provider_quote_id, provider_delivery_id, cost_cents, customer_fee_cents,
      markup_cents, status, courier_name, eta_minutes, dispatched_at, completed_at)
     VALUES ($1, 'simulated', 'sim_q_demo06', 'sim_d_demo06', 555, 649, 94, 'delivered', 'Adeel K.', 31,
      now() - interval '3 hours', now() - interval '2 hours')`,
    [completedId],
  );
  await db.query(
    `INSERT INTO order_events (order_id, type, message, actor, progress, created_at)
     VALUES ($1, 'completed', 'Delivered — enjoy your meal', 'system', 100, now() - interval '2 hours')`,
    [completedId],
  );
}

/**
 * Demo data for the ERP expansion. Everything is additive and clearly marked as
 * sandbox: a verified driver with an ATO trip, a live own-fleet delivery on the
 * map, customer and driver promotions, a returns → community programme with a
 * first-comment-wins example, and a detached Square POS sync record.
 */
async function seedPlatformExpansion(db: Database) {
  const { iso } = getTimeParts();
  const [year, month] = iso.split("-").map(Number);
  const start = month >= 7 ? year : year - 1;
  const fy = `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
  const rate = Number(DEFAULT_SETTINGS.ato_cents_per_km_current) || 91;

  // One coordinate pair per delivery address; customers and staff see the same
  // pin on the map. The small offsets keep the demo markers apart in Sydney.
  await db.query(
    `UPDATE orders
      SET delivery_lat = -33.8740 + (id % 10) * 0.0012,
          delivery_lng = 151.2035 + (id % 8) * 0.0014,
          payment_option = CASE
            WHEN payment_method = 'online' AND payment_status = 'paid'
              THEN COALESCE(payment_option, 'card_visa')
            ELSE payment_option END
      WHERE channel = 'delivery'`,
  );
  await db.query(
    `UPDATE customers SET address_lat = -33.8722, address_lng = 151.2061
      WHERE address IS NOT NULL`,
  );

  const approvedDriverId = await db.insert(
    `INSERT INTO drivers (code, first_name, last_name, email, phone, status,
      vehicle_type, vehicle_rego, vehicle_make, licence_number, licence_state,
      licence_expiry, insurance_provider, insurance_expiry, abn,
      right_to_work_country, police_check_ref, pay_id, address, suburb, postcode,
      base_lat, base_lng, current_lat, current_lng, last_seen_at,
      commission_percent, per_delivery_fee_cents, max_radius_km,
      terms_accepted_at, privacy_accepted_at, approved_at, approved_by, notes,
      created_at, updated_at)
     VALUES ('KB-DRV-001', 'Adeel', 'Khan', 'adeel.driver@khanbaba.com.au', '0400 123 456',
      'approved', 'car', 'NSW-KB-240', 'Toyota Corolla', 'NSW-8839201', 'NSW',
      '2028-06-30', 'NRMA', '2027-03-31', '51824756201', 'Australia', 'NPC-2026-1182',
      'adeel.driver@khanbaba.com.au', '12 Harris Street', 'Pyrmont', '2009',
      -33.8688, 151.2093, -33.8727, 151.2056, now() - interval '2 minutes',
      15, 300, 15, now() - interval '32 days', now() - interval '32 days',
      now() - interval '30 days', 'admin@khanbaba.com.au',
      'Demo partner: all seven checks verified before approval.',
      now() - interval '32 days', now() - interval '2 minutes')
     RETURNING id`,
  );
  const applicantId = await db.insert(
    `INSERT INTO drivers (code, first_name, last_name, email, phone, status,
      vehicle_type, vehicle_rego, licence_number, abn, address, suburb, postcode,
      base_lat, base_lng, max_radius_km, terms_accepted_at, privacy_accepted_at,
      notes, created_at)
     VALUES ('KB-DRV-002', 'Mariam', 'Ali', 'mariam.applicant@example.com', '0400 987 654',
      'under_review', 'bicycle', NULL, 'NSW-7711200', '61293847510',
      '8 George Street', 'Sydney', '2000', -33.8680, 151.2085, 8,
      now() - interval '1 day', now() - interval '1 day',
      'Demo application — documents are awaiting verification.',
      now() - interval '1 day')
     RETURNING id`,
  );

  const requiredDocuments = [
    "photo_id",
    "licence",
    "insurance",
    "police_check",
    "right_to_work",
    "abn",
    "bank",
  ];
  for (const driverId of [approvedDriverId, applicantId]) {
    const approved = driverId === approvedDriverId;
    for (const kind of requiredDocuments) {
      await db.query(
        `INSERT INTO driver_documents (driver_id, kind, reference, status,
          verified_by, verified_at, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now() - interval '31 days',now() - interval '30 days')`,
        [
          driverId,
          kind,
          `DEMO-${kind.toUpperCase()}-${driverId}`,
          approved ? "verified" : "submitted",
          approved ? "admin@khanbaba.com.au" : null,
          approved ? new Date(Date.now() - 30 * 86400000).toISOString() : null,
          approved ? "Verified against the original document." : "Awaiting review",
        ],
      );
    }
    await db.query(
      `INSERT INTO driver_verification_events (driver_id, action, detail, actor, created_at)
       VALUES ($1,'application','Driver application received','community',now() - interval '32 days')`,
      [driverId],
    );
  }
  await db.query(
    `INSERT INTO driver_verification_events (driver_id, action, detail, actor, created_at)
     VALUES ($1,'approved','All seven compliance checks verified — dispatch enabled','admin@khanbaba.com.au',now() - interval '30 days')`,
    [approvedDriverId],
  );

  const completedJob = await db.maybeOne<{ id: number; order_id: number }>(
    `SELECT j.id, j.order_id FROM delivery_jobs j JOIN orders o ON o.id = j.order_id
      WHERE o.code = 'KB-DEMO06' ORDER BY j.id LIMIT 1`,
  );
  if (completedJob) {
    await db.query(
      `UPDATE delivery_jobs SET provider = 'own_fleet', driver_id = $1,
        driver_fee_cents = 547, driver_settled_at = now() - interval '2 hours',
        distance_km = 3.8 WHERE id = $2`,
      [approvedDriverId, completedJob.id],
    );
    for (const [kind, amount, description] of [
      ["delivery_fee", 300, "Completed delivery KB-DEMO06 — base fee"],
      ["commission", 97, "Completed delivery KB-DEMO06 — 15% commission"],
      ["bonus", 150, "Driver partner weekend bonus"],
    ] as [string, number, string][]) {
      await db.query(
        `INSERT INTO driver_ledger (driver_id, job_id, order_id, kind, amount_cents,
          description, settled_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,NULL,now() - interval '2 hours')`,
        [approvedDriverId, completedJob.id, completedJob.order_id, kind, amount, description],
      );
    }
    await db.query(
      `INSERT INTO driver_trips (driver_id, job_id, order_id, order_code,
        start_lat, start_lng, end_lat, end_lng, distance_km, purpose, method,
        source, financial_year, rate_cents_per_km, claim_cents, started_at,
        ended_at, notes, created_at)
       VALUES ($1,$2,$3,'KB-DEMO06',-33.8688,151.2093,-33.8744,151.2056,3.8,
        'Delivering customer orders','cents_per_km','gps',$4,$5,$6,
        now() - interval '3 hours',now() - interval '2 hours',
        'GPS breadcrumbs from the driver portal; 2026-27 ATO rate captured on the trip.',
        now() - interval '2 hours')`,
      [
        approvedDriverId,
        completedJob.id,
        completedJob.order_id,
        fy,
        rate,
        Math.round(3.8 * rate),
      ],
    );
  }

  // A live own-fleet job so the customer tracking page, delivery desk and
  // driver portal all have a real map to show straight after seeding.
  const variant = await db.one<{ item_id: number; variant_id: number; name: string }>(
    `SELECT mi.id AS item_id, iv.id AS variant_id, mi.name
      FROM menu_items mi JOIN item_variants iv ON iv.item_id = mi.id
      WHERE mi.slug = 'butter-chicken' ORDER BY iv.sort_order LIMIT 1`,
  );
  const liveOrderId = await db.insert(
    `INSERT INTO orders (code, tracking_token, channel, customer_name, phone,
      address, suburb, postcode, delivery_lat, delivery_lng, subtotal_cents,
      total_cents, payment_method, payment_status, payment_ref, payment_option,
      status, progress, created_at, updated_at, confirmed_at, kitchen_started_at,
      ready_at, dispatched_at, promised_at)
     VALUES ('KB-DEMO07','demo-kb-demo07-token','delivery','Zara Ahmed','0412 345 678',
      '88 George Street','Sydney','2000',-33.8706,151.2079,2998,3647,'online','paid',
      'sim_pi_demo07','card_visa','out_for_delivery',92,
      now() - interval '50 minutes',now() - interval '10 minutes',
      now() - interval '48 minutes',now() - interval '42 minutes',
      now() - interval '30 minutes',now() - interval '22 minutes',
      now() + interval '12 minutes')
     RETURNING id`,
  );
  await db.query(
    `INSERT INTO order_items (order_id, item_id, variant_id, name, variant_label,
      qty, unit_price_cents, line_total_cents, prep_state)
     VALUES ($1,$2,$3,$4,'500 ml',1,2998,2998,'ready')`,
    [liveOrderId, variant.item_id, variant.variant_id, variant.name],
  );
  await db.query(
    `INSERT INTO order_events (order_id, type, message, actor, progress, created_at)
     VALUES ($1,'dispatched','Out for delivery with Adeel K. — live GPS tracking on','delivery',92,now() - interval '22 minutes')`,
    [liveOrderId],
  );
  const liveJobId = await db.insert(
    `INSERT INTO delivery_jobs (order_id, provider, provider_quote_id,
      provider_delivery_id, cost_cents, customer_fee_cents, markup_cents, status,
      courier_name, eta_minutes, driver_id, distance_km, quote_json,
      external_status, triggered_by, created_at, dispatched_at)
     VALUES ($1,'own_fleet','own_q_demo07','own_d_demo07',540,649,109,'dropoff',
      'Adeel K.',12,$2,3.2,'{"provider":"own_fleet","driver":{"code":"KB-DRV-001"}}',
      'dropoff','delivery',now() - interval '25 minutes',now() - interval '22 minutes')
     RETURNING id`,
    [liveOrderId, approvedDriverId],
  );
  for (const [lat, lng, minutes] of [
    [-33.8688, 151.2093, 22],
    [-33.8700, 151.2058, 14],
    [-33.8719, 151.2069, 6],
    [-33.8727, 151.2056, 2],
  ] as [number, number, number][]) {
    await db.query(
      `INSERT INTO driver_location_pings (driver_id, order_id, job_id, lat, lng,
        accuracy_m, heading, speed_kmh, source, recorded_at)
       VALUES ($1,$2,$3,$4,$5,8,110,26,'driver_app',now() - ($6::text || ' minutes')::interval)`,
      [approvedDriverId, liveOrderId, liveJobId, lat, lng, String(minutes)],
    );
  }
  await db.query(
    `UPDATE drivers SET current_lat = -33.8727, current_lng = 151.2056,
      last_seen_at = now() - interval '2 minutes' WHERE id = $1`,
    [approvedDriverId],
  );

  const welcomeId = await db.insert(
    `INSERT INTO promotions (code, name, description, audience, kind, value,
      max_discount_cents, min_subtotal_cents, channels, usage_limit,
      per_customer_limit, usage_count, active, created_at)
     VALUES ('WELCOME10','10% welcome offer','First-order discount for customers',
      'customer','percent',10,1500,2000,NULL,0,1,1,TRUE,now() - interval '20 days')
     RETURNING id`,
  );
  await db.insert(
    `INSERT INTO promotions (code, name, description, audience, kind, value,
      min_subtotal_cents, channels, usage_limit, active, created_at)
     VALUES ('FREEDEL','Free delivery weekend','Delivery fee on us over $40',
      'customer','free_delivery',0,4000,'delivery',250,TRUE,now() - interval '5 days')
     RETURNING id`,
  );
  const driverPromoId = await db.insert(
    `INSERT INTO promotions (code, name, description, audience, kind, value,
      driver_id, usage_limit, usage_count, active, created_at)
     VALUES ('DRIVERBOOST','Weekend driver bonus','$2.50 bonus on each successful delivery',
      'driver','driver_bonus',250,$1,0,1,TRUE,now() - interval '10 days')
     RETURNING id`,
    [approvedDriverId],
  );
  await db.query(
    `INSERT INTO promotion_redemptions (promotion_id, order_id, discount_cents, created_at)
     VALUES ($1,NULL,420,now() - interval '2 hours')`,
    [welcomeId],
  );
  await db.query(
    `INSERT INTO promotion_redemptions (promotion_id, job_id, driver_id,
      reward_cents, created_at)
     VALUES ($1,$2,$3,250,now() - interval '2 hours')`,
    [driverPromoId, completedJob?.id ?? null, approvedDriverId],
  );

  // Zero-cost pickup ticket for the already-claimed community example.
  const giveOrderId = await db.insert(
    `INSERT INTO orders (code, tracking_token, channel, customer_name, notes,
      subtotal_cents, surcharge_cents, total_cents, payment_method, payment_status,
      status, progress, promised_at, created_at, updated_at, ready_at)
     VALUES ('KB-GIVE-DEMO','demo-kb-give-demo-token','pickup','Community neighbour',
      'Community in need — click & collect ONLY. Pickup code KB-GIVE-CLAIMED. No charge.',
      0,0,0,'counter','paid','awaiting_collection',88,
      now() + interval '2 hours',now() - interval '20 minutes',
      now() - interval '20 minutes',now() - interval '20 minutes')
     RETURNING id`,
  );
  await db.query(
    `INSERT INTO order_items (order_id, name, variant_label, qty, unit_price_cents,
      line_total_cents, prep_state)
     VALUES ($1,'Community meal — untouched returned order','1 meal',1,0,0,'ready')`,
    [giveOrderId],
  );
  await db.query(
    `INSERT INTO order_events (order_id, type, message, actor, progress, created_at)
     VALUES ($1,'created','Click & collect booking created — present the pickup code at the counter','community',88,now() - interval '20 minutes')`,
    [giveOrderId],
  );

  const openOrder = await db.maybeOne<{ id: number }>(
    "SELECT id FROM orders WHERE code = 'KB-DEMO01'",
  );
  const claimedOrder = await db.maybeOne<{ id: number }>(
    "SELECT id FROM orders WHERE code = 'KB-DEMO03'",
  );
  if (openOrder) {
    const returnId = await db.insert(
      `INSERT INTO return_requests (order_id, code, reason, resolution, status,
        notes, requested_by, created_at)
       VALUES ($1,'RET-DEMO-OPEN','Customer cancelled after packing — untouched',
        'community','open','Redirected to the community programme','counter@khanbaba.com.au',
        now() - interval '35 minutes')
       RETURNING id`,
      [openOrder.id],
    );
    await db.query(
      `INSERT INTO order_events (order_id, type, message, actor, progress, created_at)
       VALUES ($1,'return','Return RET-DEMO-OPEN logged — community','counter@khanbaba.com.au',NULL,now() - interval '35 minutes')`,
      [openOrder.id],
    );
    const offerId = await db.insert(
      `INSERT INTO community_offers (return_id, order_id, token, pickup_code,
        title, description, contents, channel, status, claim_keyword,
        auto_reply_text, facebook_post_id, facebook_post_url, facebook_mode,
        posted_at, posted_by, comments_closed, pickup_deadline, created_at)
       VALUES ($1,$2,'demo-community-offer','KB-GIVE-OPEN',
        'Community meal from order KB-DEMO01',
        'Untouched order KB-DEMO01 is available free to a neighbour in need. Click & collect only.',
        '[{"name":"Chicken Biryani","qty":1},{"name":"Garlic Naan","qty":1}]',
        'click_and_collect','posted','MINE',$3,'sandbox-demo-open',
        '/community/demo-community-offer','sandbox',now() - interval '30 minutes',
        'counter@khanbaba.com.au',FALSE,now() + interval '1 day',
        now() - interval '34 minutes')
       RETURNING id`,
      [returnId, openOrder.id, DEFAULT_COMMUNITY_AUTO_REPLY],
    );
    for (const [kind, detail, actor] of [
      ["created", "Drafted from return RET-DEMO-OPEN", "counter@khanbaba.com.au"],
      ["posted_sandbox", "Published in sandbox mode — add Facebook Page credentials for a live post", "counter@khanbaba.com.au"],
      ["post_preview", "FIRST COMMENT WINS: be the first to comment \"MINE\" and it is yours. Click & collect only — no delivery, no payment.", "counter@khanbaba.com.au"],
    ] as [string, string, string][]) {
      await db.query(
        `INSERT INTO community_offer_events (offer_id, kind, detail, actor, created_at)
         VALUES ($1,$2,$3,$4,now() - interval '30 minutes')`,
        [offerId, kind, detail, actor],
      );
    }
  }
  if (claimedOrder) {
    const returnId = await db.insert(
      `INSERT INTO return_requests (order_id, code, reason, resolution, status,
        notes, requested_by, resolved_by, resolved_at, created_at)
       VALUES ($1,'RET-DEMO-CLAIMED','Customer cancelled after packing — untouched',
        'community','resolved','First comment claimed it for click & collect','counter@khanbaba.com.au',
        'facebook-sync',now() - interval '20 minutes',now() - interval '45 minutes')
       RETURNING id`,
      [claimedOrder.id],
    );
    const offerId = await db.insert(
      `INSERT INTO community_offers (return_id, order_id, token, pickup_code,
        title, description, contents, channel, status, claim_keyword,
        auto_reply_text, facebook_post_id, facebook_post_url, facebook_mode,
        posted_at, posted_by, comments_closed, auto_reply_posted_at, claimed_by,
        claimed_at, claim_comment_id, claim_source, claim_order_code,
        pickup_deadline, created_at)
       VALUES ($1,$2,'demo-community-claimed','KB-GIVE-CLAIMED',
        'Community meal from order KB-DEMO03',
        'Untouched order KB-DEMO03 is available free to a neighbour in need. Click & collect only.',
        '[{"name":"Butter Chicken","qty":1},{"name":"Mango Lassi","qty":1}]',
        'click_and_collect','claimed','MINE',$3,'sandbox-demo-claimed',
        '/community/demo-community-claimed','sandbox',now() - interval '40 minutes',
        'counter@khanbaba.com.au',TRUE,now() - interval '20 minutes','Ayesha K.',
        now() - interval '20 minutes','sandbox-comment-1','facebook','KB-GIVE-DEMO',
        now() + interval '2 hours',now() - interval '44 minutes')
       RETURNING id`,
      [returnId, claimedOrder.id, DEFAULT_COMMUNITY_AUTO_REPLY],
    );
    for (const [kind, detail, actor] of [
      ["created", "Drafted from return RET-DEMO-CLAIMED", "counter@khanbaba.com.au"],
      ["posted_sandbox", "Published in sandbox mode", "counter@khanbaba.com.au"],
      ["claimed", "Ayesha K. claimed the meal (facebook) — click & collect only", "facebook-sync"],
      ["auto_reply", DEFAULT_COMMUNITY_AUTO_REPLY, "facebook-sync"],
      ["comments_blocked", "Post closed to further comments", "facebook-sync"],
    ] as [string, string, string][]) {
      await db.query(
        `INSERT INTO community_offer_events (offer_id, kind, detail, actor, created_at)
         VALUES ($1,$2,$3,$4,now() - interval '20 minutes')`,
        [offerId, kind, detail, actor],
      );
    }
  }

  // Detached POS bridge: a sandbox sync record and a mirrored transaction.
  await db.query(
    `INSERT INTO square_sync_records (direction, entity, entity_ref, external_id,
      status, message, payload, created_at)
     VALUES ('outbound','order','KB-DEMO06','sq-order-demo06','ok',
      'Sandbox mirror — set SQUARE_ACCESS_TOKEN + SQUARE_LOCATION_ID for live POS sync',
      '{"mode":"sandbox","order":"KB-DEMO06"}',now() - interval '1 hour')`,
  );
  await db.query(
    `INSERT INTO square_transactions (external_id, kind, source, order_code,
      amount_cents, currency, status, occurred_at, raw, created_at)
     VALUES ('sq-pay-demo06','payment','square','KB-DEMO06',4847,'AUD','COMPLETED',
      now() - interval '2 hours','{"mode":"sandbox"}',now() - interval '2 hours')`,
  );

  await db.query(
    `INSERT INTO whats_new (title, summary, body, category, version, pr_number,
      pr_url, pinned, published_at)
     VALUES ('ERP expansion: every partner in one portal',
      'DoorDash, a verified driver network, live maps, promotions, community returns and a detached Square POS bridge.',
      'Delivery now compares Uber Direct, DoorDash Drive and our own verified drivers. Drivers are onboarded with seven compliance checks, GPS tracking, commission on successful delivery and an ATO cents-per-km CSV. Customers can use Visa, Mastercard, Amex, Afterpay or PayPal and promotion codes; returned untouched meals go to the community through a first-comment-wins Facebook post with the exact thank-you auto-reply and blocked comments. Square POS is a separate synchronisation boundary — the ordering core never depends on it.',
      'feature','2.0.0',11,'https://github.com/Raheelatta1984/KhanBabaResturants/pull/11',FALSE,
      now() - interval '10 minutes')`,
  );
}

/* ===========================================================================
   v3 demo data · the Lahore music room, WhatsApp commerce and guest feedback
   ========================================================================== */

type VariantPick = {
  item_id: number;
  variant_id: number;
  name: string;
  label: string;
  price_cents: number;
};

/**
 * Seeds the music library and schedule, a sandbox WhatsApp conversation with a
 * real order, central stock levels, a parked table bill and a completed meal
 * with a Google review draft. The audio URLs are clearly-labelled demo files —
 * a restaurant replaces them from Admin → Music with its own licensed songs.
 */
async function seedLahoreAndWhatsApp(db: Database): Promise<void> {
  const variant = async (slug: string): Promise<VariantPick | null> =>
    db.maybeOne<VariantPick>(
      `SELECT mi.id AS item_id, iv.id AS variant_id, mi.name, iv.label, iv.price_cents
         FROM menu_items mi
         JOIN item_variants iv ON iv.item_id = mi.id AND iv.active
        WHERE mi.slug = $1
        ORDER BY iv.is_default DESC, iv.sort_order, iv.id LIMIT 1`,
      [slug],
    );

  const [biryani, butterChicken, naan, lassi, gulabJamun] = await Promise.all([
    variant("chicken-biryani"),
    variant("butter-chicken"),
    variant("garlic-naan"),
    variant("mango-lassi"),
    variant("gulab-jamun"),
  ]);

  await db.query(
    `INSERT INTO whats_new (title, summary, body, category, version, pinned, published_at)
     VALUES ('WhatsApp ordering, dine-in settlement and the Lahore music room',
      'Take orders in WhatsApp, publish the whole menu to the WhatsApp catalogue, settle table bills at the counter, turn feedback into Google review drafts and run the room’s music on a schedule.',
      'WhatsApp Business is now a first-class channel: the portal publishes every dish to the WhatsApp catalogue with central stock, and a guest can order by messaging the business number. The counter is notified on WhatsApp, accepts the ticket and sends a secure payment link; payment clears, the ticket goes to the kitchen. Dine-in and table orders are settled only at the counter after the meal, and the counter can park the bill until it clears. After settlement a two-tap feedback link produces a Google review draft with the dish photos, the bill range and how many people were served. The room gets a Lahore cultural theme and a scheduled music system — music and religious collections, auto day/time schedules, stop/resume/replay for counter and admin, guest requests with a mandatory link and staff-approved charges that can be waived or adjusted. A religious collection is never interrupted by ambience or the table-order thank-you.',
      'feature','3.0.0',FALSE,now() - interval '2 minutes')`,
  );

  // A demo staff number so the sandbox can show exactly where an order lands.
  // Replace it in Admin → WhatsApp Business with the real counter phone.
  await db.query(
    `UPDATE settings SET value = '+61400000000' WHERE key = 'whatsapp_counter_number' AND value = ''`,
  );
  await db.query(
    `UPDATE settings SET value = '+61290001234' WHERE key = 'whatsapp_display_number' AND value = ''`,
  );

  // ------------------------------------------------------------------ music
  const track = async (input: {
    title: string;
    artist: string;
    url: string;
    kind: "music" | "religious";
    category: string;
    duration: number;
    notes?: string;
  }): Promise<number> =>
    db.insert(
      `INSERT INTO music_tracks (title, artist, url, provider, kind, category,
         duration_seconds, notes, created_by)
       VALUES ($1,$2,$3,'audio',$4,$5,$6,$7,'seed') RETURNING id`,
      [
        input.title,
        input.artist,
        input.url,
        input.kind,
        input.category,
        input.duration,
        input.notes ?? "Demo audio — replace with your licensed recording from the library.",
      ],
    );

  const qawwali1 = await track({
    title: "Lahore evening — qawwali refrain",
    artist: "House ensemble (demo)",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    kind: "music",
    category: "qawwali",
    duration: 372,
  });
  const ghazal1 = await track({
    title: "Chai and a ghazal",
    artist: "House ensemble (demo)",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    kind: "music",
    category: "ghazal",
    duration: 425,
  });
  const punjabi1 = await track({
    title: "Punjabi folk — dholak loop",
    artist: "House ensemble (demo)",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
    kind: "music",
    category: "punjabi",
    duration: 298,
  });
  const instrumental1 = await track({
    title: "Sitar at the counter",
    artist: "House ensemble (demo)",
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
    kind: "music",
    category: "instrumental",
    duration: 341,
  });
  const tilawat1 = await track({
    title: "Tilawat — Surah Al-Fatiha",
    artist: "Mishary Alafasy",
    url: "https://everyayah.com/data/Alafasy_128kbps/001001.mp3",
    kind: "religious",
    category: "recitation",
    duration: 34,
    notes: "Recitation. Ambience and table-order music stay silent while this plays.",
  });
  const tilawat2 = await track({
    title: "Tilawat — Surah Al-Ikhlas",
    artist: "Mishary Alafasy",
    url: "https://everyayah.com/data/Alafasy_128kbps/112001.mp3",
    kind: "religious",
    category: "recitation",
    duration: 21,
    notes: "Recitation. Ambience and table-order music stay silent while this plays.",
  });
  const naat1 = await track({
    title: "Friday naat — evening set",
    artist: "House reciter (demo)",
    url: "https://everyayah.com/data/Alafasy_128kbps/002255.mp3",
    kind: "religious",
    category: "naat",
    duration: 58,
    notes: "Religious set placeholder — upload your licensed naat.",
  });

  const collection = async (
    slug: string,
    name: string,
    description: string,
    kind: "music" | "religious",
    tracks: number[],
  ): Promise<number> => {
    const id = await db.insert(
      `INSERT INTO music_collections (slug, name, description, kind, created_by)
       VALUES ($1,$2,$3,$4,'seed') RETURNING id`,
      [slug, name, description, kind],
    );
    let position = 1;
    for (const trackId of tracks) {
      await db.query(
        `INSERT INTO music_collection_tracks (collection_id, track_id, position)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [id, trackId, position],
      );
      position += 1;
    }
    return id;
  };

  const evening = await collection(
    "lahore-evening",
    "Lahore evening",
    "Qawwali, ghazal and Punjabi folk for the dinner service — kept low.",
    "music",
    [qawwali1, ghazal1, punjabi1, instrumental1],
  );
  const friday = await collection(
    "friday-naat",
    "Friday naat & tilawat",
    "Devotional set for Friday evening. Ambience stays silent while this plays.",
    "religious",
    [naat1, tilawat1, tilawat2],
  );
  const morning = await collection(
    "morning-chai",
    "Morning chai",
    "Gentle instrumental set for the quiet hours.",
    "music",
    [instrumental1, ghazal1],
  );

  await db.query(
    `INSERT INTO music_schedules (collection_id, label, days, start_time, end_time, priority, created_by)
     VALUES ($1,'Lunch and afternoon',NULL,'11:00','17:00',5,'seed')`,
    [morning],
  );
  await db.query(
    `INSERT INTO music_schedules (collection_id, label, days, start_time, end_time, priority, created_by)
     VALUES ($1,'Friday evening naat',5,'17:00','20:00',20,'seed')`,
    [friday],
  );
  await db.query(
    `INSERT INTO music_schedules (collection_id, label, days, start_time, end_time, priority, created_by)
     VALUES ($1,'Dinner service',NULL,'17:00','23:30',10,'seed')`,
    [evening],
  );

  await db.query(
    `INSERT INTO music_player (id, collection_id, track_id, status, volume, mode, started_at, updated_at, updated_by)
     VALUES (1, $1, $2, 'playing', 20, 'auto', now(), now(), 'seed')
     ON CONFLICT (id) DO UPDATE SET collection_id = EXCLUDED.collection_id,
       track_id = EXCLUDED.track_id, status = 'playing', volume = 20, mode = 'auto',
       updated_at = now(), updated_by = 'seed'`,
    [evening, qawwali1],
  );

  await db.query(
    `INSERT INTO music_requests (token, customer_name, phone, table_code, title, url,
      provider, note, status, charge_cents, created_at)
     VALUES ('demo-song-request','Hamza R.', '+61412555001','T04',
      'Mast Qalandar (live)','https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
      'audio','It is our anniversary — after the mains?','pending',0,now() - interval '4 minutes')`,
  );

  // -------------------------------------------------------------- inventory
  const stock = async (slug: string, qty: number, low: number, available = true) => {
    await db.query(
      `UPDATE menu_items SET track_stock = TRUE, stock_qty = $1, low_stock_level = $2,
         is_available = $3, updated_at = now() WHERE slug = $4`,
      [qty, low, available, slug],
    );
    const row = await db.maybeOne<{ id: number }>("SELECT id FROM menu_items WHERE slug = $1", [slug]);
    if (row) {
      await db.query(
        `INSERT INTO inventory_movements (item_id, delta, stock_after, reason, actor, created_at)
         VALUES ($1,$2,$2,'restock','seed',now() - interval '2 hours')`,
        [row.id, qty],
      );
    }
  };
  await stock("chicken-biryani", 18, 5);
  await stock("butter-chicken", 9, 3);
  await stock("garlic-naan", 42, 12);
  if (lassi) await stock("mango-lassi", 6, 4);
  if (gulabJamun) await stock("gulab-jamun", 0, 4, false);

  // ------------------------------------------------ central channel publishing
  const webItems = await db.query<{ id: number; slug: string; name: string }>(
    "SELECT id, slug, name FROM menu_items WHERE published ORDER BY sort_order, id LIMIT 5",
  );
  for (const item of webItems) {
    await db.query(
      `INSERT INTO channel_publications (channel, entity, entity_ref, external_id, status,
        message, payload, published_at, updated_at)
       VALUES ('whatsapp','item',$1,$2,'published',$3,$4,now(),now())
       ON CONFLICT (channel, entity, entity_ref) DO NOTHING`,
      [
        String(item.id),
        `sandbox-kb-item-${item.id}`,
        "Sandbox — payload prepared, nothing sent to Meta",
        JSON.stringify({
          retailer_id: `kb-item-${item.id}`,
          name: item.name,
          availability: "in stock",
          currency: "AUD",
        }),
      ],
    );
  }

  // ------------------------------------------------------- WhatsApp sandbox
  const conversationId = await db.insert(
    `INSERT INTO whatsapp_conversations (wa_id, display_name, phone, state, order_count,
      last_inbound_at, last_message_at, created_at)
     VALUES ('61412345678','Ayesha Khan','+61412345678','idle',1,
      now() - interval '12 minutes', now() - interval '11 minutes', now() - interval '20 minutes')
     RETURNING id`,
  );
  const waMessages: [string, string, string, string][] = [
    ["inbound", "text", "2 chicken biryani and 1 garlic naan, table 4 please", "received"],
    ["outbound", "text", "Shukriya Ayesha! Order KB-DEMO10 is with the counter. Pay at the counter after your meal — the kitchen starts as soon as they accept it.", "sent"],
    ["outbound", "cta", "New Khan Baba order — Ayesha Khan, table 4. Review and accept it in the counter portal.\n\n[Open counter] /counter?focus=KB-DEMO10", "sent"],
  ];
  for (const [direction, kind, body, status] of waMessages) {
    await db.query(
      `INSERT INTO whatsapp_messages (direction, wa_id, kind, body, status, conversation_id, created_at)
       VALUES ($1,'61412345678',$2,$3,$4,$5,now() - interval '12 minutes')`,
      [direction, kind, body, status, conversationId],
    );
  }

  // ------------------------------------------------------------- demo orders
  const table = await db.maybeOne<{ id: number }>(
    "SELECT id FROM dining_tables WHERE code = 'T04'",
  );

  const insertOrder = async (input: {
    code: string;
    channel: string;
    name: string;
    phone: string | null;
    status: string;
    progress: number;
    paymentStatus: string;
    paymentRef: string | null;
    source: string;
    tableId?: number | null;
    parked?: boolean;
    partySize?: number;
    paymentLinkToken?: string | null;
    createdMinutesAgo?: number;
    completed?: boolean;
    lines: { pick: VariantPick | null; qty: number }[];
    notes?: string | null;
    waId?: string | null;
  }): Promise<{ id: number; total: number } | null> => {
    const lines = input.lines.filter((line): line is { pick: VariantPick; qty: number } => Boolean(line.pick));
    if (lines.length === 0) return null;
    const subtotal = lines.reduce((sum, line) => sum + line.pick.price_cents * line.qty, 0);
    const id = await db.insert(
      `INSERT INTO orders (code, tracking_token, channel, source, table_id, customer_name, phone,
        notes, subtotal_cents, surcharge_cents, total_cents, payment_method, payment_status,
        payment_ref, status, progress, parked, parked_at, parked_by, party_size,
        payment_link_token, whatsapp_wa_id, promised_at, created_at, updated_at,
        confirmed_at, kitchen_started_at, ready_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $9, 'counter', $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19,
        now() - interval '40 minutes', now() - interval '60 minutes', now() - interval '10 minutes',
        now() - interval '50 minutes', now() - interval '45 minutes', now() - interval '35 minutes',
        $20)
       RETURNING id`,
      [
        input.code,
        demoTrackingToken(input.code),
        input.channel,
        input.source,
        input.tableId ?? null,
        input.name,
        input.phone,
        input.notes ?? null,
        subtotal,
        input.paymentStatus,
        input.paymentRef,
        input.status,
        input.progress,
        Boolean(input.parked),
        input.parked ? new Date(Date.now() - 15 * 60_000).toISOString() : null,
        input.parked ? "Rina Patel" : null,
        input.partySize ?? 2,
        input.paymentLinkToken ?? null,
        input.waId ?? null,
        input.completed ? new Date(Date.now() - 12 * 60_000).toISOString() : null,
      ],
    );
    for (const line of lines) {
      await db.query(
        `INSERT INTO order_items (order_id, item_id, variant_id, name, variant_label, qty,
          unit_price_cents, line_total_cents, prep_state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ready')`,
        [
          id,
          line.pick.item_id,
          line.pick.variant_id,
          line.pick.name,
          line.pick.label,
          line.qty,
          line.pick.price_cents,
          line.pick.price_cents * line.qty,
        ],
      );
    }
    await db.query(
      `INSERT INTO order_events (order_id, type, message, actor, progress, created_at)
       VALUES ($1,'created','Order placed — ${input.source === "whatsapp" ? "via WhatsApp" : input.channel}','customer',5,now() - interval '60 minutes')`,
      [id],
    );
    return { id, total: subtotal };
  };

  const meal = await insertOrder({
    code: "KB-DEMO08",
    channel: "dine_in",
    name: "Nadia & family",
    phone: "+61422555008",
    status: "completed",
    progress: 100,
    paymentStatus: "paid",
    paymentRef: "counter_cash_demo08",
    source: "table",
    partySize: 3,
    createdMinutesAgo: 90,
    completed: true,
    lines: [
      { pick: butterChicken, qty: 1 },
      { pick: naan, qty: 2 },
      { pick: lassi, qty: 1 },
    ],
    notes: "Served and settled at the counter after the meal.",
  });

  await insertOrder({
    code: "KB-DEMO09",
    channel: "table",
    tableId: table?.id ?? null,
    name: "Table 4 — evening",
    phone: null,
    status: "preparing",
    progress: 46,
    paymentStatus: "unpaid",
    paymentRef: null,
    source: "table",
    parked: true,
    partySize: 4,
    lines: [
      { pick: biryani, qty: 2 },
      { pick: naan, qty: 3 },
    ],
    notes: "Parked at the counter until the table settles after the meal.",
  });

  const waOrder = await insertOrder({
    code: "KB-DEMO10",
    channel: "table",
    tableId: table?.id ?? null,
    name: "Ayesha Khan",
    phone: "+61412345678",
    status: "pending_confirm",
    progress: 5,
    paymentStatus: "unpaid",
    paymentRef: null,
    source: "whatsapp",
    partySize: 2,
    paymentLinkToken: "demo-pay-kb-demo10",
    waId: "61412345678",
    lines: [
      { pick: biryani, qty: 2 },
      { pick: naan, qty: 1 },
    ],
    notes: "Ordered in WhatsApp. Confirm with the customer if anything is unclear.",
  });
  if (waOrder) {
    await db.query(
      `INSERT INTO order_events (order_id, type, message, actor, progress, created_at)
       VALUES ($1,'whatsapp','Order created from WhatsApp — counter notified on the business number','whatsapp',5,now() - interval '12 minutes')`,
      [waOrder.id],
    );
    await db.query(
      "UPDATE whatsapp_messages SET order_id = $1 WHERE conversation_id = $2",
      [waOrder.id, conversationId],
    );
  }

  // ------------------------------------------------------ feedback → Google
  if (meal) {
    const subtotal = meal.total;
    const inviteId = await db.insert(
      `INSERT INTO feedback_invites (order_id, token, channel, party_size, sent_at,
        submitted_at, rating, comment, highlights, created_at)
       VALUES ($1,'demo-feedback-kb-demo08','whatsapp',3,now() - interval '30 minutes',
        now() - interval '25 minutes',5,
        'The butter chicken had the proper Lahori finish and the naan came out blistering hot.',
        $2, now() - interval '30 minutes')
       RETURNING id`,
      [meal.id, JSON.stringify(["Butter Chicken", "Garlic Naan", "Mango Lassi"])],
    );
    const images = await db.query<{ image: string | null }>(
      `SELECT image FROM menu_items WHERE id = ANY($1::int[]) AND image IS NOT NULL`,
      [
        [butterChicken?.item_id, naan?.item_id, lassi?.item_id].filter(
          (id): id is number => typeof id === "number",
        ),
      ],
    );
    const body = [
      "Khan Baba Restaurant was outstanding.",
      "We were a table of 3 and everything came out together.",
      "We ordered Butter Chicken, Garlic Naan and Mango Lassi. The butter chicken had the proper Lahori finish and the naan came out blistering hot.",
      `Bill came to around $${((subtotal * 0.9) / 100).toFixed(2)}–$${((subtotal * 1.1) / 100).toFixed(2)} for 3 people.`,
      "Photos of what we had are on this review.",
    ].join(" ");
    await db.query(
      `INSERT INTO google_review_drafts (feedback_id, order_id, rating, body, image_refs,
        bill_cents, party_size, status, google_url, created_at)
       VALUES ($1,$2,5,$3,$4,$5,3,'draft',$6,now() - interval '24 minutes')`,
      [
        inviteId,
        meal.id,
        body,
        JSON.stringify(images.map((row) => row.image).filter(Boolean)),
        subtotal,
        "https://www.google.com/maps/search/?api=1&query=Khan%20Baba%20Restaurant",
      ],
    );
  }
}
