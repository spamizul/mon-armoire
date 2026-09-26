import React, { useState, useEffect, useRef } from "react";
import { Plus, X, Pencil, ChevronDown, Shirt, Layers, Sparkles, Camera, Search, Heart, ArrowLeft, Link2, Clock, Calendar, Sun, Settings, Scissors, Check, Crop, MoreVertical, Cloud, CloudOff, CloudRain, CloudSnow, CloudFog, CloudLightning } from "lucide-react";
import Cropper from "react-easy-crop";
import { supabase } from "./supabaseClient";

// ─────────────────────────────────────────────
// PALETTE — les couleurs de l'appli, centralisées ici
// pour être faciles à changer plus tard.
// ─────────────────────────────────────────────
const COLORS = {
  ink: "#111111",
  ivory: "#FFFFFF",
  card: "#FFFFFF",
  rose: "#FF4B33",
  sage: "#111111",
  gold: "#FF4B33",
  line: "#EBEBEB",
  muted: "#999999",     // texte secondaire discret (catégories, sous-titres)
  haze: "#F3F2EF",      // fond neutre discret (vignettes sans photo, cartes remplies)
};

// L'ordre ici est l'ordre d'affichage partout dans l'appli (rangées, menus…).
// "Robe" s'affiche "Robe et jupe" : le nom interne ne change pas, pour ne rien perdre.
const CATEGORIES = ["Haut", "Chemise", "Pull", "Bas", "Robe", "Veste", "Chaussures", "Accessoire"];
const CATEGORY_LABELS = { Robe: "Robe et jupe" };
function catLabel(c) {
  return CATEGORY_LABELS[c] || c;
}

// Une jupe rangée dans "Robe et jupe" se reconnaît à son nom : pour le générateur,
// elle compte comme un bas (il lui faut un haut), pas comme une robe.
function isSkirt(item) {
  return !!item && item.category === "Robe" && /jupe/i.test(item.name || "");
}
function effectiveCategory(item) {
  return isSkirt(item) ? "Bas" : item.category;
}
// Chaud : plus de 25 °C · Doux : 20 à 25 °C · Frais : 14 à 19 °C · Froid : moins de 14 °C
// (Pas de tag "Pluie" : la pluie est détectée automatiquement et ajoute une veste.)
const WEATHER_TAGS = ["Chaud", "Doux", "Frais", "Froid"];
const OCCASIONS = ["Travail", "Décontracté", "Soirée"];
const COLOR_FAMILIES = ["Neutres", "Chauds", "Froids", "Roses/Violets"];

// Déduit une "famille" de couleur à partir d'un code hexadécimal (#RRGGBB),
// pour pouvoir filtrer par couleur sans que tu aies à taguer chaque vêtement toi-même.
function hexToColorFamily(hex) {
  if (!hex) return "Neutres";
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  if (s < 0.15) return "Neutres"; // peu de saturation → gris, noir, blanc, beige...

  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;

  if (h < 70 || h >= 340) return "Chauds";       // rouge, orange, jaune
  if (h < 260) return "Froids";                   // vert, bleu
  return "Roses/Violets";
}

// Transforme un code couleur (#RRGGBB) en teinte / saturation / luminosité (HSL).
// h = position sur l'arc-en-ciel (0 à 360), s = intensité (0 à 1), l = clarté (0 = noir, 1 = blanc).
// Nom de couleur en français, pour les pastilles de la fiche vêtement.
function hexToColorName(hex) {
  const { h, s, l } = hexToHsl(hex);
  if (l < 0.13) return "Noir";
  if (l > 0.93 && s < 0.5) return "Blanc";
  if (s < 0.12) return l > 0.75 ? "Blanc cassé" : "Gris";
  if (h >= 20 && h < 55 && l > 0.62 && s < 0.6) return "Beige";
  if (h >= 10 && h < 50 && l < 0.45) return "Marron";
  if (h < 12 || h >= 345) return l > 0.72 ? "Rose" : l < 0.3 ? "Bordeaux" : "Rouge";
  if (h < 40) return "Orange";
  if (h < 65) return l < 0.4 ? "Kaki" : "Jaune";
  if (h < 165) return l < 0.3 ? "Vert foncé" : "Vert";
  if (h < 200) return "Bleu ciel";
  if (h < 250) return l < 0.3 ? "Marine" : "Bleu";
  if (h < 290) return "Violet";
  return "Rose";
}

function hexToHsl(hex) {
  if (!hex || hex.length < 7) return { h: 0, s: 0, l: 0.5 };
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

// Compare deux vêtements pour les ranger "en dégradé" :
// 1. les neutres clairs (blanc, crème, gris clair), du plus clair au plus foncé
// 2. les couleurs, dans l'ordre de l'arc-en-ciel
// 3. les neutres foncés (gris anthracite, noir), du plus clair au plus foncé
function compareByColor(a, b) {
  function key(item) {
    const { h, s, l } = hexToHsl(item.hex);
    const neutral = s < 0.15 || l > 0.93 || l < 0.12;
    if (neutral && l >= 0.5) return [0, -l];
    if (neutral) return [2, -l];
    return [1, h];
  }
  const A = key(a), B = key(b);
  return A[0] !== B[0] ? A[0] - B[0] : A[1] - B[1];
}

// ── Détection des doublons ──
// "Empreinte" d'une photo : on la réduit à 8×8 pixels en gris, et on note pour chaque pixel
// s'il est plus clair ou plus foncé que la moyenne. Deux photos presque identiques
// ont presque la même empreinte (quelques "bits" de différence seulement).
async function imageFingerprint(src) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src.startsWith("http") ? `${src}${src.includes("?") ? "&" : "?"}fp=1` : src;
  });
  const c = document.createElement("canvas");
  c.width = 8; c.height = 8;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#FFFFFF"; // fond blanc derrière les photos détourées
  ctx.fillRect(0, 0, 8, 8);
  ctx.drawImage(img, 0, 0, 8, 8);
  const d = ctx.getImageData(0, 0, 8, 8).data;
  const g = [];
  for (let p = 0; p < d.length; p += 4) g.push(0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]);
  const avg = g.reduce((a, b) => a + b, 0) / g.length;
  return g.map((v) => (v > avg ? "1" : "0")).join("");
}
function fingerprintDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 99;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}
// Nom simplifié pour comparer : minuscules, sans accents ni ponctuation.
function normalizeName(str) {
  return (str || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
// Distance entre deux couleurs (0 = identiques).
function hexDistance(a, b) {
  if (!a || !b || a.length < 7 || b.length < 7) return 999;
  const c = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const [x, y] = [c(a), c(b)];
  return Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
}

// Deux couleurs "jumelles" : très proches, même nom de couleur, et même teinte
// (un bleu très pâle et un jaune très pâle ne sont PAS jumeaux, même s'ils sont proches en clarté).
function sameColor(a, b) {
  if (hexDistance(a, b) > 32) return false;
  if (hexToColorName(a) !== hexToColorName(b)) return false;
  const x = hexToHsl(a);
  const y = hexToHsl(b);
  if (x.s < 0.12 && y.s < 0.12) return true; // blancs, gris, noirs : pas de teinte à comparer
  const dh = Math.abs(x.h - y.h);
  return Math.min(dh, 360 - dh) < 18;
}

// ── Photos détourées (fond transparent) ──
// Vrai si l'image dessinée sur ce canvas a des zones transparentes (vêtement détouré).
function canvasHasTransparency(canvas) {
  const probe = document.createElement("canvas");
  probe.width = 48;
  probe.height = 48;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, 48, 48);
  const d = ctx.getImageData(0, 0, 48, 48).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}
// Exporte un canvas : en PNG s'il a de la transparence (pour garder le détourage), sinon en JPEG (plus léger).
function canvasToDataUrl(canvas, quality = 0.85) {
  return canvasHasTransparency(canvas) ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", quality);
}
// Vrai si la photo d'un vêtement est détourée (enregistrée en PNG).
function isCutout(item) {
  return !!item && !!item.photo && /\.png(\?|$)/i.test(item.photo);
}

// Détecte la couleur principale d'une photo, directement dans le navigateur.
// On ne regarde que le centre de l'image (là où se trouve le vêtement) pour éviter
// que le fond (parquet, lit, mur…) ne fausse le résultat. Les pixels sont rangés
// dans des "paniers" de couleurs proches, et on garde la moyenne du panier le plus rempli.
async function detectColorPalette(src) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous"; // nécessaire pour analyser une photo hébergée sur Supabase
    i.onload = () => resolve(i);
    i.onerror = reject;
    // Le petit paramètre ajouté évite que le navigateur réutilise une version en cache
    // chargée sans autorisation d'analyse (souci fréquent sur Safari/iPhone).
    i.src = src.startsWith("http") ? `${src}${src.includes("?") ? "&" : "?"}color=1` : src;
  });
  const size = 60;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  // Photo détourée : on analyse toute l'image (le fond transparent est ignoré).
  // Photo normale : seulement le centre, pour éviter le fond.
  ctx.drawImage(img, 0, 0, size, size);
  const cutout = canvasHasTransparency(canvas);
  if (!cutout) {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, img.width * 0.2, img.height * 0.2, img.width * 0.6, img.height * 0.6, 0, 0, size, size);
  }
  const data = ctx.getImageData(0, 0, size, size).data;
  const buckets = {};
  let counted = 0;
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] < 128) continue; // pixel transparent : c'est le fond enlevé
    counted++;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const k = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const bucket = buckets[k] || (buckets[k] = { count: 0, r: 0, g: 0, b: 0 });
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
  }
  // Les paniers du plus rempli au moins rempli, transformés en couleurs moyennes.
  const total = counted || 1;
  const sorted = Object.values(buckets)
    .sort((a, b) => b.count - a.count)
    .map((bk) => ({ share: bk.count / total, rgb: [bk.r / bk.count, bk.g / bk.count, bk.b / bk.count] }));
  const toHex = (rgb) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  // Couleur principale = la plus présente. Couleurs secondaires (2 max) : au moins 12 % de
  // la zone analysée, et assez différentes des couleurs déjà gardées (pas deux nuances du même bleu).
  const kept = [sorted[0]];
  for (const c of sorted.slice(1)) {
    if (kept.length >= 3) break;
    if (c.share < 0.12) break;
    if (kept.every((k) => dist(k.rgb, c.rgb) > 70)) kept.push(c);
  }
  return kept.map((c) => toHex(c.rgb));
}

// Couleur principale seulement (compatibilité).
async function detectDominantColor(src) {
  return (await detectColorPalette(src))[0];
}

const EMPTY_OUTFIT_TAGS = { weather: [], occasions: [] };

// Vêtement à motifs ? Réglé à la main sur la fiche ; sinon deviné : plusieurs couleurs bien distinctes
// détectées sur la photo = motif (rayures, fleurs, carreaux…).
function isPatterned(item) {
  if (!item) return false;
  if (typeof item.pattern === "boolean") return item.pattern; // réglé à la main
  if (typeof item.patternScore === "number") return item.patternScore > 0.15; // texture de la photo
  return (item.extraHexes || []).length > 0; // à défaut : plusieurs couleurs
}

// "Texture" d'une photo : on regarde le centre (là où est le vêtement) et on compte les endroits
// où la clarté change brusquement d'un pixel à l'autre. Un tissu uni (même froissé) en a très peu
// (~1 à 5 %), un vichy, des rayures ou des fleurs en ont beaucoup (souvent plus de 30 %).
async function photoPatternScore(src) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src.startsWith("http") ? `${src}${src.includes("?") ? "&" : "?"}tx=1` : src;
  });
  const N = 128;
  const c = document.createElement("canvas");
  c.width = N; c.height = N;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, N, N);
  ctx.drawImage(img, img.width * 0.25, img.height * 0.25, img.width * 0.5, img.height * 0.5, 0, 0, N, N);
  const d = ctx.getImageData(0, 0, N, N).data;
  const L = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) L[k] = 0.299 * d[k * 4] + 0.587 * d[k * 4 + 1] + 0.114 * d[k * 4 + 2];
  let jumps = 0, total = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (x < N - 1) { total++; if (Math.abs(L[y * N + x] - L[y * N + x + 1]) > 25) jumps++; }
      if (y < N - 1) { total++; if (Math.abs(L[y * N + x] - L[(y + 1) * N + x]) > 25) jumps++; }
    }
  }
  return Math.round((jumps / total) * 1000) / 1000;
}

// Toutes les couleurs d'un vêtement : la principale, puis ses couleurs secondaires (motifs).
function itemColors(item) {
  return [item.hex, ...(item.extraHexes || [])].filter(Boolean);
}
// Vrai si l'une des couleurs du vêtement appartient à cette famille.
function itemHasFamily(item, family) {
  return itemColors(item).some((h) => hexToColorFamily(h) === family);
}

// Photo à afficher dans les vignettes : la miniature légère si elle existe, sinon la photo normale.
function thumbOf(item) {
  return item.photoThumb || item.photo;
}

// Fabrique une miniature carrée légère (240 px, ~15 Ko) à partir d'une photo,
// pour que les listes chargent vite. La grande photo reste utilisée sur la fiche.
async function makeThumbnail(src, size = 240) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src.startsWith("http") ? `${src}${src.includes("?") ? "&" : "?"}thumb=1` : src;
  });
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
  return canvasToDataUrl(canvas, 0.75);
}

// Noms au pluriel pour les titres de rangées de la Garde-robe.
const CATEGORY_PLURALS = {
  Haut: "Hauts", Pull: "Pulls", Chemise: "Chemises", Veste: "Vestes", Robe: "Robes et jupes",
  Bas: "Bas", Chaussures: "Chaussures", Accessoire: "Accessoires",
};

// Tris et filtres proposés dans la page "Tout voir" d'une catégorie.
const CATEGORY_SORTS = [
  { id: "couleur", label: "Couleur" },
  { id: "recent", label: "Récents" },
  { id: "worn", label: "Plus portés" },
  { id: "favoris", label: "Favoris" },
  { id: "jamais", label: "Jamais portés" },
  { id: "faitmain", label: "Fait main" },
];
// Vue "toutes les pièces" (ouverte depuis les chiffres de la page Aujourd'hui) : un filtre en plus.
const ALL_ITEMS_VIEW = "__all";
const ALL_SORTS = [...CATEGORY_SORTS, { id: "mois", label: "Portées ce mois-ci" }];
// Filtres par tag (météo, occasion), utilisés en haut de la Garde-robe et dans "Toutes les pièces".
const TAG_SORTS = [...WEATHER_TAGS.map((w) => ({ id: `w:${w}`, label: w })), ...OCCASIONS.map((o) => ({ id: `o:${o}`, label: o }))];
// L'ordre des onglets détermine le sens du glissement : passer de "dressing"
// à "tenues" glisse vers la gauche, l'inverse glisse vers la droite.
const TAB_ORDER = ["accueil", "dressing", "tenues", "agenda"];

// Logo "pli" : carré corail, "pli" en Merriweather italique, vague blanche en bas à droite.
function PliLogo({ size = 72 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-label="pli" role="img">
      <defs><clipPath id="pli-logo-clip"><rect width="100" height="100" rx="22.5" /></clipPath></defs>
      <g clipPath="url(#pli-logo-clip)">
        <rect width="100" height="100" fill="#FF4B33" />
        <path transform="translate(100,0) scale(-1,1)" d="M-4 46 Q8 52 10 62 T26 74 T40 90 T54 104" fill="none" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" />
        <text x="44" y="52" textAnchor="middle" fill="#FFFFFF" style={{ fontFamily: "'Merriweather', serif", fontWeight: 700, fontStyle: "italic", fontSize: 40 }}>pli</text>
      </g>
    </svg>
  );
}

// ── Synchro : outils ──
// JSON avec les clés toujours dans le même ordre (Supabase les réordonne),
// pour pouvoir comparer deux versions des données de façon fiable.
function stableStringify(v) {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
  }
  return JSON.stringify(v === undefined ? null : v);
}
// Petite empreinte d'un texte : si elle change, les données ont changé.
function hashString(str) {
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = (h1 * 33) ^ c;
    h2 = (h2 * 33) ^ c;
  }
  return str.length + "-" + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}
function sameTime(a, b) {
  return !!a && !!b && new Date(a).getTime() === new Date(b).getTime();
}

function getGreeting(name) {
  const hour = new Date().getHours();
  if (hour < 12) return `Bonjour ${name}`;
  if (hour < 18) return `Bon après-midi ${name}`;
  return `Bonsoir ${name}`;
}

// Formate une date ISO en "27 août" par exemple, pour l'affichage de l'historique.
function formatDate(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

export default function App() {
  // ── ÉTAT (state) ──────────────────────────
  const [items, setItems] = useState([]);
  const [outfits, setOutfits] = useState([]);
  // L'agenda associe une date (format "AAAA-MM-JJ") à l'id d'une tenue :
  // { "2026-08-29": 123, "2026-09-01": 456 }
  const [agenda, setAgenda] = useState({});
  const [loaded, setLoaded] = useState(false);
  // Prénom de la personne, demandé une seule fois au tout premier lancement.
  const [userName, setUserName] = useState(null);
  const [nameInput, setNameInput] = useState("");
  // Météo du jour, affichée sur la page Aujourd'hui. "idle"/"loading"/"granted"/"denied"/"error".
  const [weather, setWeather] = useState(null);
  const [weatherStatus, setWeatherStatus] = useState("idle");
  const [weatherCity, setWeatherCity] = useState("");
  // Page Aujourd'hui : tenue affichée dans le carrousel, et carte "Redécouvre".
  const [todaySlide, setTodaySlide] = useState(0);
  const [rediscoverSkip, setRediscoverSkip] = useState(0);
  const [rediscoverHidden, setRediscoverHidden] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mon-armoire-rediscover-hidden") || "{}"); } catch { return {}; }
  });
  // Garantit que l'écran d'ouverture reste visible au moins un court instant,
  // même si le chargement des données est instantané.
  const [splashDone, setSplashDone] = useState(false);
  const [view, setView] = useState("accueil");
  // "right" = le nouveau contenu arrive depuis la droite (on avance dans les onglets),
  // "left" = il arrive depuis la gauche (on recule). Détermine l'animation à jouer.
  const [slideDir, setSlideDir] = useState("right");

  // Change d'onglet en calculant automatiquement la bonne direction de glissement.
  function changeView(newView) {
    const from = TAB_ORDER.indexOf(view);
    const to = TAB_ORDER.indexOf(newView);
    setSlideDir(to >= from ? "right" : "left");
    setView(newView);
    setDetailItemId(null);
    setCategoryView(null);
    setOutfitGroupView(null);
    setTodaySlide(0);
    setShowAddMenu(false);
    setCarnetViewId(null);
  }

  // ── Fermer une popup en la faisant glisser vers le bas depuis sa petite barre du haut ──
  // Marche pour toutes les popups qui ont la petite barre grise (data-sheet-handle).
  useEffect(() => {
    let drag = null;
    const onStart = (e) => {
      const h = e.target.closest && e.target.closest("[data-sheet-handle]");
      if (!h) return;
      const sheet = h.parentElement;
      drag = { y: e.touches[0].clientY, dy: 0, sheet };
      sheet.style.transition = "none";
    };
    const onMove = (e) => {
      if (!drag) return;
      drag.dy = Math.max(0, e.touches[0].clientY - drag.y);
      drag.sheet.style.transform = `translateY(${drag.dy}px)`;
      e.preventDefault(); // pas de défilement de la page pendant qu'on tire la popup
    };
    const onEnd = () => {
      if (!drag) return;
      const { sheet, dy } = drag;
      drag = null;
      sheet.style.transition = "transform 0.2s ease-out";
      if (dy > 90) {
        sheet.style.transform = "translateY(100%)";
        setTimeout(() => {
          sheet.style.transition = "";
          sheet.style.transform = "";
          sheet.parentElement && sheet.parentElement.click(); // comme un toucher à côté : ferme la popup
        }, 180);
      } else {
        sheet.style.transform = "";
      }
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, []);

  // Détection du glissement au doigt (swipe) : on note où le doigt touche l'écran,
  // et où il le quitte, pour calculer la distance et la direction du geste.
  const touchStartX = useRef(null);
  function handleTouchStart(e) {
    // Pas de changement d'onglet quand on fait défiler une rangée de vêtements au doigt.
    if (e.target.closest("[data-no-swipe]")) {
      touchStartX.current = null;
      return;
    }
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchEnd(e) {
    if (touchStartX.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;

    const SWIPE_THRESHOLD = 60; // en pixels : évite de déclencher sur un simple tapotement
    if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;

    const currentIndex = TAB_ORDER.indexOf(view);
    if (deltaX < 0 && currentIndex < TAB_ORDER.length - 1) {
      // Glissement vers la gauche = onglet suivant
      changeView(TAB_ORDER[currentIndex + 1]);
    } else if (deltaX > 0 && currentIndex > 0) {
      // Glissement vers la droite = onglet précédent
      changeView(TAB_ORDER[currentIndex - 1]);
    }
  }

  // ── Glisser depuis le bord gauche pour revenir en arrière (comme sur iPhone) ──
  const edgeSwipe = useRef(null);
  function handleEdgeTouchStart(e) {
    const t = e.touches[0];
    // Seulement si le geste commence tout près du bord gauche de l'écran.
    edgeSwipe.current = t.clientX < 28 ? { x: t.clientX, y: t.clientY } : null;
  }
  function handleEdgeTouchEnd(e) {
    const start = edgeSwipe.current;
    edgeSwipe.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = Math.abs(t.clientY - start.y);
    if (dx > 70 && dy < 60) goBack();
  }
  // Revient à l'écran précédent de l'onglet en cours (fiche → liste, "Tout voir" → rangées…).
  function goBack() {
    if (detailItemId !== null) setDetailItemId(null);
    else if (categoryView) setCategoryView(null);
    else if (detailOutfitId !== null) setDetailOutfitId(null);
    else if (outfitGroupView) setOutfitGroupView(null);
  }

  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  // Page "Tout voir" : la catégorie affichée en grille complète (null = vue en rangées).
  const [categoryView, setCategoryView] = useState(null);
  const [categorySort, setCategorySort] = useState("couleur");
  // Id du vêtement dont la couleur est en cours de détection (null = aucune).
  const [detectingColors, setDetectingColors] = useState(null);

  const [form, setForm] = useState({ name: "", category: "Haut", hex: "#C4808C", photo: null, weather: [], occasions: [] });
  // Recadrage de photo : la popup s'ouvre juste après avoir choisi un fichier,
  // avant que la photo ne soit vraiment enregistrée dans le formulaire.
  const [showCropModal, setShowCropModal] = useState(false);
  // Info sur la photo choisie (format reçu, fond transparent ou non), affichée dans le recadreur.
  const [cropInfo, setCropInfo] = useState(null);
  const [rawImageSrc, setRawImageSrc] = useState(null); // la photo brute, pas encore recadrée
  const [cropPosition, setCropPosition] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  // Vrai pendant que les photos sont envoyées vers le stockage en ligne.
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // À qui la photo recadrée doit être appliquée : null = au formulaire d'ajout,
  // sinon l'id d'un vêtement déjà enregistré (modification depuis sa fiche).
  const [cropTargetItemId, setCropTargetItemId] = useState(null);
  // Le formulaire d'ajout est replié par défaut : on arrive direct sur le dressing.
  const [showAddForm, setShowAddForm] = useState(false);
  // Le formulaire de création de tenue est replié par défaut : on arrive direct sur les tenues enregistrées.
  const [showOutfitForm, setShowOutfitForm] = useState(false);
  // "select" (choix des vêtements) ou "summary" (récap + nom + enregistrement)
  const [createOutfitStep, setCreateOutfitStep] = useState("select");
  // Contrôle l'ouverture de la popup "tenue du jour" sur la page Aujourd'hui.
  // Identifiant de l'entrée d'agenda actuellement ouverte en popup (null = fermée).
  // On garde l'id plutôt qu'un simple booléen car il peut y avoir plusieurs tenues le même jour.
  const [openEntryId, setOpenEntryId] = useState(null);
  // Contrôle le petit sélecteur "ajouter/échanger" à l'intérieur de la popup tenue du jour.
  const [showModalPicker, setShowModalPicker] = useState(false);

  const [outfitName, setOutfitName] = useState("");
  // Tags choisis pour la tenue en cours de création (saisons, météo, occasions).
  const [outfitTags, setOutfitTags] = useState(EMPTY_OUTFIT_TAGS);
  const [selectedIds, setSelectedIds] = useState([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  // Page Tenues : rangée ouverte en "Tout voir" (null = vue en rangées).
  const [outfitGroupView, setOutfitGroupView] = useState(null);
  // Page Tenues : tags cochés en haut (on ne garde que les tenues concernées)
  // et ouverture du cadre "Parfaites pour aujourd'hui".
  const [outfitTagFilter, setOutfitTagFilter] = useState({ fav: false, weather: [], occasions: [] });
  const [todayPicksOpen, setTodayPicksOpen] = useState(false);
  const [outfitWeatherFilter, setOutfitWeatherFilter] = useState("Tous");
  const [outfitOccasionFilter, setOutfitOccasionFilter] = useState("Tous");
  // Filtre catégorie pour le sélecteur de vêtements, séparé pour chaque écran
  // (choisir "Bas" dans Tenues ne doit pas affecter le sélecteur de l'Agenda).

  // Champs du formulaire de planification dans l'agenda.
  const [planDate, setPlanDate] = useState("");
  const [planItemIds, setPlanItemIds] = useState([]);
  const [planLabel, setPlanLabel] = useState(""); // ex: "Soir" — permet plusieurs tenues le même jour
  // Popup de sélection rapide, ouverte depuis la page Aujourd'hui (aujourd'hui/demain) sans quitter la page.
  const [showQuickPlanModal, setShowQuickPlanModal] = useState(false);
  // "choice" (choisir la méthode) | "existing" (tenue déjà enregistrée) | "create" (sélection manuelle)
  const [quickPlanMode, setQuickPlanMode] = useState("choice");
  // Coché : la tenue créée via "Planifier" sera aussi enregistrée dans la collection de tenues.
  const [alsoSaveOutfit, setAlsoSaveOutfit] = useState(false);
  // Le mois actuellement affiché dans le calendrier de l'agenda.
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  // La date dont on affiche le détail dans la popup "jour" (null = fermée).
  const [dayViewDate, setDayViewDate] = useState(null);
  // Agenda : onglet "Calendrier" ou "Carnet" (les photos des tenues portées).
  const [agendaTab, setAgendaTab] = useState("calendrier");
  // Menu du bouton "+" central de la barre (éventail).
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRules, setShowRules] = useState(false);
  // Visionneuse du Carnet : id de la photo affichée (null = fermée).
  const [carnetViewId, setCarnetViewId] = useState(null);
  // Popup d'un jour ouverte depuis les rangées par mois : simple visualisation (pas de planification).
  const [dayViewReadOnly, setDayViewReadOnly] = useState(false);
  // Sélecteur pour ajouter / retirer des pièces d'une tenue prévue (sans toucher à la tenue enregistrée).
  const [entryPicker, setEntryPicker] = useState(null);
  // Quand une fiche en ouvre une autre (tenue → pièce, pièce → tenue), la dernière ouverte passe devant.
  const [lastFiche, setLastFiche] = useState("item");
  const [carnetShowPieces, setCarnetShowPieces] = useState(false);
  useEffect(() => { setCarnetShowPieces(false); }, [carnetViewId]);
  // Recherche dans les Tenues (ouverte avec la loupe, avec les tags dessous).
  const [showOutfitSearch, setShowOutfitSearch] = useState(false);
  const [outfitQuery, setOutfitQuery] = useState("");
  // Règles du générateur, réglables dans les Paramètres (gardées sur cet appareil).
  const [genRules, setGenRules] = useState(() => {
    const defaults = { onePattern: true, max3Colors: true, oneBold: true, colorRecall: true, contrast: true, oldSchool: false };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem("mon-armoire-rules") || "{}") }; } catch { return defaults; }
  });
  function setGenRule(key, value) {
    setGenRules((prev) => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem("mon-armoire-rules", JSON.stringify(next)); } catch {}
      return next;
    });
  }
  // Doublons détectés au moment d'ajouter un vêtement / d'enregistrer une tenue.
  const [itemDup, setItemDup] = useState(null);
  const [outfitDup, setOutfitDup] = useState(null);
  // Fiche tenue : sélecteur pour ajouter / retirer des pièces.
  const [outfitPiecePicker, setOutfitPiecePicker] = useState(false);
  const [reusableDup, setReusableDup] = useState(null);
  useEffect(() => { setReusableDup(null); }, [openEntryId, showQuickPlanModal, planItemIds, dayViewDate]);
  useEffect(() => { setItemDup(null); }, [form.name, form.photo, form.category, form.hex]);
  useEffect(() => { setOutfitDup(null); }, [selectedIds]);
  // Id de l'entrée d'agenda dont la photo portée est en cours d'envoi ("new" pour une nouvelle).
  const [uploadingWornFor, setUploadingWornFor] = useState(null);
  // Mois ouverts dans l'Agenda (null = par défaut, seul le mois en cours est ouvert).
  const [agendaOpenMonths, setAgendaOpenMonths] = useState(null);
  const daySwipeX = useRef(null);

  function togglePlanItem(id) {
    setPlanItemIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  }

  // Ouvre la popup de sélection rapide, pré-remplie avec la date choisie (aujourd'hui ou demain).
  function openQuickPlan(dateStr) {
    setPlanDate(dateStr);
    setPlanItemIds([]);
    setPlanLabel("");
    setQuickPlanMode("choice");
    setShowQuickPlanModal(true);
  }

  // Popup de confirmation générique avant une suppression irréversible.
  // { message, onConfirm } ou null si fermée.
  const [confirmDialog, setConfirmDialog] = useState(null);
  function askConfirm(message, onConfirm) {
    setConfirmDialog({ message, onConfirm });
  }

  // Quel vêtement est actuellement affiché en fiche détaillée (null = aucun).
  const [detailItemId, setDetailItemId] = useState(null);
  // Fiche vêtement : onglet ouvert, menu "⋯", et petit message de confirmation.
  const [detailTab, setDetailTab] = useState("apropos");
  const [itemMenuOpen, setItemMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  useEffect(() => { setDetailTab("apropos"); setItemMenuOpen(false); }, [detailItemId]);
  const [outfitTab, setOutfitTab] = useState("apropos");
  const [outfitMenuOpen, setOutfitMenuOpen] = useState(false);
  // Quelle tenue est actuellement affichée en fiche détaillée (null = aucune).
  const [detailOutfitId, setDetailOutfitId] = useState(null);
  useEffect(() => { setOutfitTab("apropos"); setOutfitMenuOpen(false); setOutfitPiecePicker(false); if (detailOutfitId) setLastFiche("outfit"); }, [detailOutfitId]);
  useEffect(() => { if (detailItemId !== null) setLastFiche("item"); }, [detailItemId]);

  // Popup de sélection des vêtements "qui vont bien avec" celui affiché en fiche.
  const [showPairsModal, setShowPairsModal] = useState(false);

  // ── CHARGEMENT / SAUVEGARDE (localStorage) ──
  useEffect(() => {
    const savedItems = localStorage.getItem("mon-armoire-items");
    setItems(savedItems ? JSON.parse(savedItems) : []);
    const savedOutfits = localStorage.getItem("mon-armoire-outfits");
    setOutfits(savedOutfits ? JSON.parse(savedOutfits) : []);
    const savedAgenda = localStorage.getItem("mon-armoire-agenda");
    setAgenda(savedAgenda ? JSON.parse(savedAgenda) : {});
    const savedName = localStorage.getItem("mon-armoire-username");
    if (savedName) setUserName(savedName);
    setLoaded(true);
    requestWeather();

    // 1900ms : le temps pour la cascade logo → titre → sous-titre de bien se dérouler.
    const timer = setTimeout(() => setSplashDone(true), 1900);
    return () => clearTimeout(timer); // nettoyage si le composant disparaît avant la fin
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem("mon-armoire-items", JSON.stringify(items));
    } catch (err) {
      alert("Le stockage de ton téléphone est plein (souvent à cause de trop de photos). Essaie de retirer une photo ou un vêtement pour libérer de la place.");
    }
  }, [items, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem("mon-armoire-outfits", JSON.stringify(outfits));
    } catch (err) {
      alert("Le stockage de ton téléphone est plein (souvent à cause de trop de photos). Essaie de retirer une photo ou un vêtement pour libérer de la place.");
    }
  }, [outfits, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem("mon-armoire-agenda", JSON.stringify(agenda));
    } catch (err) {
      alert("Le stockage de ton téléphone est plein (souvent à cause de trop de photos). Essaie de retirer une photo ou un vêtement pour libérer de la place.");
    }
  }, [agenda, loaded]);

  // ── SYNCHRO EN LIGNE (Supabase) ──────────────
  // Principe : ce téléphone garde TOUJOURS sa copie (localStorage), l'appli marche hors ligne.
  // Chaque changement est envoyé en ligne ~1,5 s après. À l'ouverture (et quand on revient
  // sur l'appli), on regarde s'il y a plus récent en ligne. Si les deux ont changé en même
  // temps, on demande quoi garder au lieu d'écraser en silence.
  const readLS = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const [syncCode, setSyncCode] = useState(() => readLS("mon-armoire-sync-code"));
  const syncCodeRef = useRef(syncCode);
  const [syncStatus, setSyncStatus] = useState(() => (readLS("mon-armoire-sync-code") ? "ok" : "off")); // off | ok | pending | saving | offline | error
  const [syncedAt, setSyncedAt] = useState(() => readLS("mon-armoire-sync-at"));
  const syncedAtRef = useRef(syncedAt);
  const syncedHashRef = useRef(readLS("mon-armoire-sync-hash"));
  const syncBusy = useRef(false);
  const pushTimer = useRef(null);
  const [showSyncSheet, setShowSyncSheet] = useState(false);
  const [syncSetup, setSyncSetup] = useState({ code: "", step: "code", remote: null, busy: false, error: "" });

  function syncPayload(src) {
    return {
      items: src.items || [],
      outfits: src.outfits || [],
      agenda: src.agenda || {},
      userName: src.userName || null,
      rediscoverHidden: src.rediscoverHidden || {},
    };
  }
  const payloadHash = (p) => hashString(stableStringify(p));
  const latestPayloadRef = useRef(null);
  latestPayloadRef.current = syncPayload({ items, outfits, agenda, userName, rediscoverHidden });

  function markSynced(at, hash) {
    syncedAtRef.current = at;
    syncedHashRef.current = hash;
    setSyncedAt(at);
    try {
      localStorage.setItem("mon-armoire-sync-at", at);
      localStorage.setItem("mon-armoire-sync-hash", hash);
    } catch {}
  }

  // Garde-fou : on n'accepte que des données qui ressemblent vraiment à Mon Armoire.
  function isValidRemote(d) {
    return d && Array.isArray(d.items) && Array.isArray(d.outfits || []) && typeof (d.agenda || {}) === "object";
  }

  // Remplace les données de cet appareil par celles venues d'en ligne. Renvoie leur empreinte.
  function applyRemote(d) {
    const p = syncPayload(d);
    setItems(p.items);
    setOutfits(p.outfits);
    setAgenda(p.agenda);
    setRediscoverHidden(p.rediscoverHidden);
    try { localStorage.setItem("mon-armoire-rediscover-hidden", JSON.stringify(p.rediscoverHidden)); } catch {}
    if (p.userName) {
      try { localStorage.setItem("mon-armoire-username", p.userName); } catch {}
      setUserName(p.userName);
    }
    return payloadHash(p);
  }

  // Les deux versions ont changé : on demande laquelle garder.
  async function resolveConflict(remote) {
    const local = latestPayloadRef.current;
    const keepLocal = window.confirm(
      `Tes données ont changé sur un autre appareil ET sur celui-ci.\n\n` +
      `OK : garder celles de CET appareil (${local.items.length} vêtements, ${local.outfits.length} tenues).\n` +
      `Annuler : prendre celles de l'autre appareil (${remote.data.items.length} vêtements, ${(remote.data.outfits || []).length} tenues).`
    );
    if (keepLocal) {
      const hash = payloadHash(local);
      const { data, error } = await supabase.rpc("armoire_set", { p_code: syncCodeRef.current, p_data: local, p_base: null, p_force: true });
      if (error) throw error;
      markSynced(data, hash);
    } else {
      markSynced(remote.updated_at, applyRemote(remote.data));
    }
    setSyncStatus("ok");
  }

  // Envoie la version de cet appareil en ligne.
  async function pushNow() {
    const code = syncCodeRef.current;
    if (!code) return;
    if (syncBusy.current) { clearTimeout(pushTimer.current); pushTimer.current = setTimeout(pushNow, 1000); return; }
    const payload = latestPayloadRef.current;
    const hash = payloadHash(payload);
    if (hash === syncedHashRef.current) { setSyncStatus("ok"); return; }
    // Garde-fou : jamais d'envoi automatique d'une armoire vide (ça effacerait tout en ligne).
    if (payload.items.length === 0) { setSyncStatus("ok"); return; }
    if (!navigator.onLine) { setSyncStatus("offline"); return; }
    syncBusy.current = true;
    setSyncStatus("saving");
    try {
      const { data, error } = await supabase.rpc("armoire_set", { p_code: code, p_data: payload, p_base: syncedAtRef.current, p_force: false });
      if (error) {
        if (String(error.message || "").includes("conflict")) {
          const got = await supabase.rpc("armoire_get", { p_code: code });
          if (got.error || !got.data || !isValidRemote(got.data.data)) throw got.error || new Error("bad remote");
          await resolveConflict(got.data);
        } else {
          throw error;
        }
      } else {
        markSynced(data, hash);
        setSyncStatus("ok");
      }
    } catch (err) {
      setSyncStatus(navigator.onLine ? "error" : "offline");
    } finally {
      syncBusy.current = false;
    }
    // Des changements faits pendant l'envoi ? On renvoie.
    if (syncCodeRef.current && payloadHash(latestPayloadRef.current) !== syncedHashRef.current) {
      clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(pushNow, 800);
    }
  }

  // Regarde s'il y a plus récent en ligne.
  async function pullNow() {
    const code = syncCodeRef.current;
    if (!code) return;
    if (!navigator.onLine) { setSyncStatus("offline"); return; }
    if (syncBusy.current) return;
    syncBusy.current = true;
    let needPush = false;
    try {
      const { data, error } = await supabase.rpc("armoire_get", { p_code: code });
      if (error) throw error;
      const localChanged = payloadHash(latestPayloadRef.current) !== syncedHashRef.current;
      if (!data) {
        needPush = true; // rien en ligne pour ce code : on y met la version de cet appareil
      } else if (sameTime(data.updated_at, syncedAtRef.current)) {
        needPush = localChanged; // rien de neuf en ligne
        if (!localChanged) setSyncStatus("ok");
      } else if (!isValidRemote(data.data)) {
        setSyncStatus("error");
      } else if (!localChanged) {
        markSynced(data.updated_at, applyRemote(data.data));
        setSyncStatus("ok");
      } else {
        await resolveConflict(data);
      }
    } catch (err) {
      setSyncStatus(navigator.onLine ? "error" : "offline");
    } finally {
      syncBusy.current = false;
    }
    if (needPush) pushNow();
  }

  // Chaque changement → envoi en ligne 1,5 s plus tard (on regroupe les changements rapprochés).
  useEffect(() => {
    if (!loaded || !syncCode) return;
    if (payloadHash(latestPayloadRef.current) === syncedHashRef.current) return;
    setSyncStatus("pending");
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(pushNow, 1500);
  }, [items, outfits, agenda, userName, rediscoverHidden, loaded, syncCode]);

  // À l'ouverture, au retour sur l'appli et au retour du réseau : on vérifie en ligne.
  useEffect(() => {
    if (!loaded || !syncCode) return;
    pullNow();
    const onVisible = () => { if (document.visibilityState === "visible") pullNow(); };
    const onOnline = () => pullNow();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [loaded, syncCode]);

  function enableSync(code) {
    syncCodeRef.current = code;
    try { localStorage.setItem("mon-armoire-sync-code", code); } catch {}
    setSyncCode(code);
  }

  function disableSync() {
    clearTimeout(pushTimer.current);
    syncCodeRef.current = null;
    syncedAtRef.current = null;
    syncedHashRef.current = null;
    ["mon-armoire-sync-code", "mon-armoire-sync-at", "mon-armoire-sync-hash"].forEach((k) => { try { localStorage.removeItem(k); } catch {} });
    setSyncCode(null);
    setSyncedAt(null);
    setSyncStatus("off");
  }

  // Première mise en route sur un appareil : on vérifie le code, puis on voit ce qu'il y a en ligne.
  async function startSyncSetup() {
    const code = syncSetup.code.trim();
    if (code.length < 8) { setSyncSetup((s) => ({ ...s, error: "8 caractères minimum." })); return; }
    setSyncSetup((s) => ({ ...s, busy: true, error: "" }));
    try {
      const { data, error } = await supabase.rpc("armoire_get", { p_code: code });
      if (error) throw error;
      const local = latestPayloadRef.current;
      if (!data) {
        // Nouveau code : on envoie les données de cet appareil.
        const { data: at, error: e2 } = await supabase.rpc("armoire_set", { p_code: code, p_data: local, p_base: null, p_force: false });
        if (e2) throw e2;
        markSynced(at, payloadHash(local));
        enableSync(code);
        setSyncStatus("ok");
        setSyncSetup({ code: "", step: "done", remote: null, busy: false, error: "" });
      } else if (!isValidRemote(data.data)) {
        setSyncSetup((s) => ({ ...s, busy: false, error: "Les données en ligne semblent abîmées. Rien n'a été modifié." }));
      } else if (local.items.length === 0) {
        // Appareil vide : on récupère simplement ce qui est en ligne.
        markSynced(data.updated_at, applyRemote(data.data));
        enableSync(code);
        setSyncStatus("ok");
        setSyncSetup({ code: "", step: "done", remote: null, busy: false, error: "" });
      } else {
        setSyncSetup((s) => ({ ...s, busy: false, step: "choose", remote: data }));
      }
    } catch (err) {
      setSyncSetup((s) => ({ ...s, busy: false, error: "Impossible de joindre Supabase. Vérifie ta connexion (et que le code SQL a bien été lancé)." }));
    }
  }

  // Les deux ont des données : l'utilisatrice choisit laquelle garder.
  async function finishSyncSetup(keep) {
    const code = syncSetup.code.trim();
    const remote = syncSetup.remote;
    setSyncSetup((s) => ({ ...s, busy: true, error: "" }));
    try {
      if (keep === "remote") {
        markSynced(remote.updated_at, applyRemote(remote.data));
      } else {
        const local = latestPayloadRef.current;
        const { data: at, error } = await supabase.rpc("armoire_set", { p_code: code, p_data: local, p_base: null, p_force: true });
        if (error) throw error;
        markSynced(at, payloadHash(local));
      }
      enableSync(code);
      setSyncStatus("ok");
      setSyncSetup({ code: "", step: "done", remote: null, busy: false, error: "" });
    } catch (err) {
      setSyncSetup((s) => ({ ...s, busy: false, error: "L'envoi a échoué. Rien n'a été perdu, réessaie." }));
    }
  }

  function formatSyncTime(at) {
    if (!at) return "";
    const d = new Date(at);
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay
      ? `à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
      : `le ${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;
  }

  // Crée en arrière-plan, une seule fois, les miniatures des vêtements ajoutés avant
  // cette amélioration. Une photo à la fois, sans bloquer l'appli ; en cas d'échec
  // (pas de réseau…), on réessaiera au prochain lancement.
  const thumbsMigrationStarted = useRef(false);
  useEffect(() => {
    if (!loaded || thumbsMigrationStarted.current) return;
    const todo = items.filter((i) => i.photo && !i.photoThumb && i.photo.startsWith("http"));
    if (todo.length === 0) return;
    thumbsMigrationStarted.current = true;
    (async () => {
      for (const item of todo) {
        try {
          const thumbUrl = await uploadPhotoToStorage(await makeThumbnail(item.photo), "thumb");
          setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, photoThumb: thumbUrl } : i)));
        } catch (err) {}
      }
    })();
  }, [loaded, items]);

  // Calcule en arrière-plan, une fois, l'empreinte des photos déjà enregistrées (pour repérer les doublons).
  const fingerprintsStarted = useRef(false);
  useEffect(() => {
    if (!loaded || fingerprintsStarted.current) return;
    const todo = items.filter((i) => i.photo && (!i.photoHash || typeof i.patternScore !== "number"));
    if (todo.length === 0) return;
    fingerprintsStarted.current = true;
    (async () => {
      for (const item of todo) {
        try {
          const patch = {};
          if (!item.photoHash) patch.photoHash = await imageFingerprint(thumbOf(item));
          // La texture se mesure sur la grande photo (sur la miniature, un petit vichy devient flou).
          if (typeof item.patternScore !== "number") patch.patternScore = await photoPatternScore(item.photo);
          setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));
        } catch (err) {}
      }
    })();
  }, [loaded, items]);

  // Vêtements qui ressemblent beaucoup à celui qu'on s'apprête à ajouter :
  // photo presque identique, ou même nom, ou même catégorie + couleur très proche + un mot en commun.
  function findSimilarItems(cand) {
    const generic = new Set(["pull", "haut", "robe", "jupe", "veste", "chemise", "pantalon", "jean", "tshirt", "t", "shirt", "top", "manches", "longues", "courtes", "avec", "sans"]);
    const words = normalizeName(cand.name).split(" ").filter((w) => w.length >= 3 && !generic.has(w));
    const candCat = effectiveCategory(cand);
    return items
      .map((i) => {
        let score = 0;
        if (cand.photoHash && i.photoHash && fingerprintDistance(cand.photoHash, i.photoHash) <= 6) score = 3;
        else if (normalizeName(cand.name) && normalizeName(cand.name) === normalizeName(i.name)) score = 2;
        else if (effectiveCategory(i) === candCat && sameColor(cand.hex, i.hex) && words.some((w) => normalizeName(i.name).split(" ").includes(w))) score = 1;
        return { item: i, score };
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((m) => m.item);
  }

  // ── ACTIONS SUR LES VÊTEMENTS ──────────────
  // Au lieu d'enregistrer directement la photo choisie, on ouvre d'abord
  // la popup de recadrage — la vraie photo n'est enregistrée qu'après validation.
  function handlePhotoChange(e, targetItemId) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const resized = await resizeImageDataUrl(reader.result);
        // Le fond est-il transparent ? (photo détourée par l'iPhone, par exemple)
        try {
          const im = await loadImage(resized);
          const cv = document.createElement("canvas");
          cv.width = im.width; cv.height = im.height;
          cv.getContext("2d").drawImage(im, 0, 0);
          setCropInfo({ type: file.type || "inconnu", transparent: canvasHasTransparency(cv) });
        } catch { setCropInfo(null); }
        setRawImageSrc(resized);
        setCropPosition({ x: 0, y: 0 });
        setCropZoom(1);
        setCropTargetItemId(targetItemId || null);
        setShowCropModal(true);
      } catch (err) {
        alert("Cette photo n'a pas pu être ouverte. Essaie avec une autre photo (ou une version JPEG/PNG si c'est un format spécial comme HEIC).");
      }
    };
    reader.onerror = () => {
      alert("Cette photo n'a pas pu être ouverte. Essaie avec une autre photo (ou une version JPEG/PNG si c'est un format spécial comme HEIC).");
    };
    reader.readAsDataURL(file);
    e.target.value = ""; // pour pouvoir resélectionner le même fichier plus tard si besoin
  }

  // Charge une image et attend qu'elle soit prête, pour pouvoir la dessiner sur un canvas.
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // Réduit une photo trop grande (typiquement une photo prise direct avec l'appareil photo
  // d'un téléphone, souvent plusieurs millions de pixels) AVANT de l'envoyer au recadreur —
  // sinon ça peut surcharger la mémoire du téléphone et faire planter la page sans message d'erreur.
  async function resizeImageDataUrl(dataUrl, maxDim = 1600) {
    const img = await loadImage(dataUrl);
    const { width, height } = img;
    if (width <= maxDim && height <= maxDim) return dataUrl; // déjà raisonnable, rien à faire
    const scale = maxDim / Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvasToDataUrl(canvas, 0.85);
  }

  // Découpe réellement l'image selon la zone choisie dans le recadreur,
  // en dessinant uniquement cette zone sur un canvas, puis en l'exportant en data URL.
  async function getCroppedImage(imageSrc, cropAreaPixels) {
    const image = await loadImage(imageSrc);
    // On plafonne la taille de sortie — la photo ne s'affiche jamais à plus de
    // 200px dans l'appli, pas la peine de stocker beaucoup plus lourd que ça.
    const outputSize = Math.min(cropAreaPixels.width, 800);
    const canvas = document.createElement("canvas");
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(
      image,
      cropAreaPixels.x, cropAreaPixels.y, cropAreaPixels.width, cropAreaPixels.height,
      0, 0, outputSize, outputSize
    );
    return canvasToDataUrl(canvas, 0.85);
  }

  // Valide le recadrage : découpe l'image et l'enregistre dans le formulaire.
  // Envoie une image (data URL) vers le stockage Supabase, et renvoie son lien public.
  // C'est ce lien (une simple ligne de texte) qui est enregistré dans l'appli désormais,
  // au lieu de l'image entière — ça évite de remplir le stockage limité du téléphone.
  async function uploadPhotoToStorage(dataUrl, label) {
    const blob = await (await fetch(dataUrl)).blob();
    // PNG si la photo est détourée (fond transparent), sinon JPEG.
    const type = blob.type === "image/png" ? "image/png" : blob.type === "image/webp" ? "image/webp" : "image/jpeg";
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    const path = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("photos").upload(path, blob, { contentType: type, cacheControl: "31536000" });
    if (error) throw error;
    const { data } = supabase.storage.from("photos").getPublicUrl(path);
    return data.publicUrl;
  }

  // Supprime un fichier du stockage Supabase à partir de son lien public.
  // "Best-effort" : si ça échoue (lien déjà supprimé, vieille photo en base64
  // d'avant Supabase, etc.), on l'ignore silencieusement plutôt que de bloquer.
  function deleteFromStorage(url) {
    if (!url || !url.includes("/storage/v1/object/public/photos/")) return;
    const path = url.split("/storage/v1/object/public/photos/")[1];
    if (path) supabase.storage.from("photos").remove([path]).catch(() => {});
  }

  async function confirmCrop() {
    if (!croppedAreaPixels) return;
    setUploadingPhoto(true);
    try {
      const croppedDataUrl = await getCroppedImage(rawImageSrc, croppedAreaPixels);
      // Détection automatique de la couleur du vêtement sur la photo recadrée.
      // Si ça échoue, on garde simplement la couleur actuelle.
      let detectedHex = null;
      let detectedExtras = [];
      try {
        const pal = await detectColorPalette(croppedDataUrl);
        detectedHex = pal[0];
        detectedExtras = pal.slice(1);
      } catch (err) {}
      let photoHash = null;
      try { photoHash = await imageFingerprint(croppedDataUrl); } catch {}
      let patternScore = null;
      try { patternScore = await photoPatternScore(croppedDataUrl); } catch {}
      const photoUrl = await uploadPhotoToStorage(croppedDataUrl, "photo");
      const thumbUrl = await uploadPhotoToStorage(await makeThumbnail(croppedDataUrl), "thumb");
      const originalUrl = await uploadPhotoToStorage(rawImageSrc, "original");
      if (cropTargetItemId) {
        // On modifie la photo d'un vêtement déjà enregistré, depuis sa fiche.
        // On garde aussi "photoOriginal" (la source utilisée pour ce recadrage), pour pouvoir
        // rouvrir le recadreur plus tard sur l'intégralité de l'image plutôt que sur un carré déjà coupé.
        const oldItem = items.find((i) => i.id === cropTargetItemId);
        setItems((prev) => prev.map((i) => (i.id === cropTargetItemId ? { ...i, photo: photoUrl, photoThumb: thumbUrl, photoOriginal: originalUrl, photoHash, patternScore, ...(detectedHex && { hex: detectedHex, extraHexes: detectedExtras }) } : i)));
        // On retire les anciennes versions du stockage, maintenant qu'elles ne sont plus utilisées.
        if (oldItem) {
          deleteFromStorage(oldItem.photo);
          deleteFromStorage(oldItem.photoThumb);
          deleteFromStorage(oldItem.photoOriginal);
        }
      } else {
        setForm((prev) => ({ ...prev, photo: photoUrl, photoThumb: thumbUrl, photoOriginal: originalUrl, photoHash, patternScore, ...(detectedHex && { hex: detectedHex, extraHexes: detectedExtras }) }));
      }
    } catch (err) {
      alert("L'envoi de cette photo a échoué (vérifie ta connexion internet, ou réessaie dans un instant).");
    }
    setUploadingPhoto(false);
    setShowCropModal(false);
    setRawImageSrc(null);
    setCropTargetItemId(null);
  }

  function toggleFormWeather(tag) {
    setForm((prev) => ({
      ...prev,
      weather: prev.weather.includes(tag)
        ? prev.weather.filter((w) => w !== tag)
        : [...prev.weather, tag],
    }));
  }

  function toggleFormOccasion(tag) {
    setForm((prev) => ({
      ...prev,
      occasions: prev.occasions.includes(tag)
        ? prev.occasions.filter((o) => o !== tag)
        : [...prev.occasions, tag],
    }));
  }

  // Renvoie true si le vêtement a bien été ajouté (false si on attend une confirmation "doublon").
  function addItem(e, force = false) {
    if (e) e.preventDefault();
    if (!form.name.trim()) return false;
    if (!force) {
      const similar = findSimilarItems(form);
      if (similar.length) { setItemDup(similar); return false; }
    }
    setItemDup(null);
    const newItem = { id: Date.now(), ...form, pairsWith: [], wornDates: [] };
    setItems((prev) => [...prev, newItem]);
    setForm({ name: "", category: form.category, hex: "#C4808C", extraHexes: [], photo: null, weather: [], occasions: [], handmade: false });
    showToast({ text: `« ${newItem.name} » ajouté ✓`, action: "Voir", onAction: () => { changeView("dressing"); setDetailItemId(newItem.id); } });
    return true;
  }

  function removeItem(id) {
    // On supprime aussi ses photos du stockage en ligne, pour ne pas laisser
    // de fichiers orphelins qui occuperaient de la place pour rien.
    const item = items.find((i) => i.id === id);
    if (item) {
      deleteFromStorage(item.photo);
      deleteFromStorage(item.photoThumb);
      deleteFromStorage(item.photoOriginal);
    }
    setItems((prev) => prev.filter((item) => item.id !== id));
    // On enlève aussi cet id de tous les "va bien avec" qui le référençaient.
    setItems((prev) => prev.map((i) => ({ ...i, pairsWith: (i.pairsWith || []).filter((p) => p !== id) })));
    if (detailItemId === id) setDetailItemId(null);
  }

  // Lie ou délie deux vêtements entre eux ("va bien avec"), dans les deux sens.
  function togglePair(itemId, otherId) {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id === itemId) {
          const has = (i.pairsWith || []).includes(otherId);
          return { ...i, pairsWith: has ? (i.pairsWith || []).filter((p) => p !== otherId) : [...(i.pairsWith || []), otherId] };
        }
        if (i.id === otherId) {
          const has = (i.pairsWith || []).includes(itemId);
          return { ...i, pairsWith: has ? (i.pairsWith || []).filter((p) => p !== itemId) : [...(i.pairsWith || []), itemId] };
        }
        return i;
      })
    );
  }

  // ── CE QUI COMPTE COMME "PORTÉ" ──
  // Un vêtement (ou une tenue) est porté un jour s'il a été validé ce jour-là ("Je la porte"),
  // OU s'il est noté dans l'agenda à cette date — aujourd'hui ou un jour passé (pas le futur).
  const wornIndex = (() => {
    const today = new Date().toISOString().slice(0, 10);
    const itemsMap = new Map();
    const outfitsMap = new Map();
    const add = (m, k, d) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(d); };
    Object.entries(agenda).forEach(([dateStr, v]) => {
      if (dateStr > today) return;
      normalizeDayEntries(v).forEach((e) => {
        (e.itemIds || []).forEach((id) => add(itemsMap, id, dateStr));
        if (e.outfitId) add(outfitsMap, e.outfitId, dateStr);
      });
    });
    return { itemsMap, outfitsMap };
  })();
  // Jours où c'est porté ("2026-09-25"…), sans doublon, du plus ancien au plus récent.
  function wornDays(obj, isOutfit) {
    const set = new Set((obj.wornDates || []).map((d) => new Date(d).toISOString().slice(0, 10)));
    const extra = (isOutfit ? wornIndex.outfitsMap : wornIndex.itemsMap).get(obj.id);
    if (extra) extra.forEach((d) => set.add(d));
    return [...set].sort();
  }
  function itemWornDays(item) { return wornDays(item, false); }
  function outfitWornDays(outfit) { return wornDays(outfit, true); }

  // Trie une liste de vêtements : "couleur" (dégradé), "worn" (plus portés d'abord)
  // ou "recent" (derniers ajoutés d'abord).
  function sortItems(list, mode) {
    const copy = [...list];
    if (mode === "couleur") return copy.sort(compareByColor);
    if (mode === "worn") return copy.sort((a, b) => itemWornDays(b).length - itemWornDays(a).length);
    return copy.sort((a, b) => b.id - a.id);
  }

  // Vêtements affichés dans la page "Tout voir" de la catégorie ouverte.
  // "Favoris" et "Jamais portés" filtrent, puis on range par couleur.
  const categoryItems = categoryView
    ? sortItems(
        items
          .filter((i) => categoryView === ALL_ITEMS_VIEW || i.category === categoryView)
          .filter((i) => categorySort !== "favoris" || i.favorite)
          .filter((i) => categorySort !== "jamais" || itemWornDays(i).length === 0)
          .filter((i) => categorySort !== "faitmain" || i.handmade)
          .filter((i) => !categorySort.startsWith("w:") || (i.weather || []).includes(categorySort.slice(2)))
          .filter((i) => !categorySort.startsWith("o:") || (i.occasions || []).includes(categorySort.slice(2)))
          .filter((i) => categorySort !== "mois" || itemWornDays(i).some((d) => d.slice(0, 7) === new Date().toISOString().slice(0, 7))),
        ["favoris", "jamais", "mois", "faitmain"].includes(categorySort) || categorySort.includes(":") ? "couleur" : categorySort
      )
    : [];

  // Résultats de la recherche (toutes catégories confondues).
  const searchResults = searchQuery.trim()
    ? sortItems(items.filter((i) => i.name.toLowerCase().includes(searchQuery.trim().toLowerCase())), "couleur")
    : [];

  const favoriteItemsCount = items.filter((i) => i.favorite).length;

  function toggleFavoriteItem(id) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, favorite: !i.favorite } : i)));
  }

  // Détecte la couleur principale depuis la photo d'un vêtement (bouton sur sa fiche).
  async function detectItemColor(item) {
    if (!item.photo) return;
    setDetectingColors(item.id);
    try {
      const pal = await detectColorPalette(item.photo);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, hex: pal[0], extraHexes: pal.slice(1) } : i)));
    } catch (err) {
      alert("La photo n'a pas pu être analysée. Tu peux choisir la couleur à la main.");
    }
    setDetectingColors(null);
  }

  // Sélecteur de vêtements en rangées par catégorie (comme la Garde-robe), réutilisé
  // dans les popups : "va bien avec", planification depuis l'Agenda, tenue du jour.
  //   isSelected(item) → vrai si la pièce est cochée · onPick(item) → au toucher
  //   exclude(item) → vrai pour masquer une pièce · size → taille des vignettes
  // Les photos ne se chargent qu'en arrivant à l'écran.
  function renderItemRows({ isSelected = () => false, onPick, exclude = () => false, size = 76 }) {
    const groups = CATEGORIES
      .map((cat) => ({ cat, list: sortItems(items.filter((i) => i.category === cat && !exclude(i)), "couleur") }))
      .filter((g) => g.list.length > 0);
    if (groups.length === 0) {
      return <p className="text-sm py-6 text-center" style={{ color: COLORS.muted }}>Aucune pièce</p>;
    }
    return (
      <div className="flex flex-col gap-4">
        {groups.map(({ cat, list }) => (
          <section key={cat}>
            <p className="text-xs mb-1.5" style={{ fontWeight: 600 }}>
              {CATEGORY_PLURALS[cat] || cat}{" "}
              <span style={{ fontWeight: 400, color: COLORS.muted }}>· {list.length}</span>
            </p>
            <div data-no-swipe className="no-scrollbar -mx-5 px-5 py-1 flex gap-2 overflow-x-auto">
              {list.map((item) => {
                const on = isSelected(item);
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => onPick(item)}
                    aria-label={item.name}
                    aria-pressed={on}
                    className="relative flex-shrink-0 overflow-hidden"
                    style={{ width: size, height: size, borderRadius: 12, background: COLORS.haze, boxShadow: on ? `0 0 0 2px ${COLORS.rose}` : "none" }}
                  >
                    {item.photo ? (
                      <img src={thumbOf(item)} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    ) : (
                      <div style={{ background: item.hex, width: "100%", height: "100%" }} />
                    )}
                    {on && (
                      <span className="absolute w-5 h-5 rounded-full flex items-center justify-center" style={{ top: 4, right: 4, background: COLORS.rose }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    );
  }

  // Titre modifiable directement (nom d'un vêtement ou d'une tenue) : on touche, on tape.
  // Un petit crayon indique qu'on peut le modifier ; un nom vide reprend l'ancien.
  function renderEditableTitle(value, onSave, label) {
    return (
      <label className="flex items-center gap-2 flex-1 min-w-0 cursor-text">
        <input
          key={value}
          defaultValue={value}
          aria-label={label}
          onBlur={(e) => {
            e.target.style.borderBottomColor = "transparent";
            const v = e.target.value.trim();
            if (v && v !== value) onSave(v);
            else e.target.value = value;
          }}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          className="display flex-1 min-w-0 text-xl outline-none"
          style={{ fontWeight: 700, background: "transparent", borderBottom: "1px dashed transparent" }}
          onFocus={(e) => { e.target.style.borderBottomColor = COLORS.line; }}
        />
        <Pencil size={15} style={{ opacity: 0.35, flexShrink: 0 }} />
      </label>
    );
  }

  // Une vignette de vêtement : juste la photo (ou sa couleur s'il n'y en a pas),
  // avec un petit cœur si c'est un favori.
  // Petit interrupteur (oui / non), utilisé pour "Fait main".
  function renderSwitch(on, onToggle, label) {
    return (
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onToggle}
        style={{ width: 46, height: 28, borderRadius: 14, background: on ? COLORS.rose : "#E2E0DC", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
        <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 22, height: 22, borderRadius: 11, background: "#FFFFFF", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.2s" }} />
      </button>
    );
  }

  function renderItemTile(item, sizeStyle) {
    return (
      <button
        key={item.id}
        onClick={() => setDetailItemId(item.id)}
        aria-label={item.name}
        className="relative rounded-2xl overflow-hidden flex-shrink-0"
        style={{ background: "#F3F2EF", ...sizeStyle }}
      >
        {item.photo ? (
          <img src={thumbOf(item)} alt={item.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ background: item.hex, width: "100%", height: "100%" }} />
        )}
        {item.favorite && (
          <Heart
            size={15}
            color={COLORS.rose}
            fill={COLORS.rose}
            style={{ position: "absolute", top: 8, right: 8, filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }}
          />
        )}
        {item.handmade && (
          <span className="absolute flex items-center justify-center" title="Fait main" style={{ left: 6, bottom: 6, width: 22, height: 22, borderRadius: 11, background: "rgba(255,255,255,0.92)" }}>
            <Scissors size={12} color={COLORS.rose} />
          </span>
        )}
      </button>
    );
  }

  const detailItem = items.find((i) => i.id === detailItemId);

  // ── ACTIONS SUR LES TENUES ──────────────────
  function toggleSelected(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  }

  // Prochain nom automatique : "Tenue 1", "Tenue 2"… On part du plus grand numéro
  // déjà utilisé, pour ne jamais créer deux fois le même nom après une suppression.
  function nextOutfitName() {
    const numbers = outfits
      .map((o) => /^Tenue (\d+)$/.exec((o.name || "").trim()))
      .filter(Boolean)
      .map((m) => Number(m[1]));
    return `Tenue ${numbers.length ? Math.max(...numbers) + 1 : 1}`;
  }

  // Logique d'enregistrement d'une tenue, réutilisable depuis le formulaire
  // classique ET depuis la popup du générateur.
  // Tenue existante identique (mêmes pièces) ou très proche (une seule pièce de différence).
  // Compare une sélection de pièces à tes tenues enregistrées :
  // - "exact" : exactement les mêmes pièces ;
  // - "twin"  : même look avec des pièces jumelles (ex. deux chemises blanches différentes :
  //             même catégorie, couleur très proche) ;
  function findSimilarOutfit(itemIds, excludeId) {
    const ids = [...new Set(itemIds)];
    const byId = (id) => items.find((i) => i.id === id);
    let twin = null;
    for (const o of outfits) {
      if (o.id === excludeId) continue;
      const oi = [...new Set(o.itemIds || [])];
      const onlyNew = ids.filter((id) => !oi.includes(id));
      const onlyOld = oi.filter((id) => !ids.includes(id));
      if (!onlyNew.length && !onlyOld.length) return { outfit: o, kind: "exact", exact: true, diff: [], pairs: [] };
      // Même look : les pièces qui diffèrent sont soit des "jumelles" (même catégorie, même couleur),
      // soit juste des chaussures ou des accessoires (changer de chaussures ne change pas la tenue).
      if (!twin && ids.length >= 2) {
        const MINOR = ["Chaussures", "Accessoire"];
        const isMinor = (id) => { const x = byId(id); return x && MINOR.includes(effectiveCategory(x)); };
        const leftOld = [...onlyOld];
        const leftNew = [];
        const pairs = [];
        for (const nid of onlyNew) {
          const n = byId(nid);
          const k = leftOld.findIndex((oid) => { const x = byId(oid); return n && x && effectiveCategory(n) === effectiveCategory(x) && sameColor(n.hex, x.hex); });
          if (k === -1) leftNew.push(nid);
          else { pairs.push([leftOld[k], nid]); leftOld.splice(k, 1); }
        }
        const mainShared = ids.filter((id) => !isMinor(id)).length > 0;
        if (mainShared && leftNew.every(isMinor) && leftOld.every(isMinor)) {
          twin = { outfit: o, kind: "twin", exact: false, diff: [...onlyNew, ...onlyOld], pairs, minorNew: leftNew, minorOld: leftOld };
        }
      }
    }
    return twin;
  }
  // Texte qui explique la différence : "Chemise blanche ↔ Chemise blanche en lin".
  function describeOutfitDiff(m) {
    const name = (id) => (items.find((i) => i.id === id) || {}).name || "?";
    const parts = (m.pairs || []).map(([a, b]) => `${name(b)} au lieu de ${name(a)}`);
    const mn = m.minorNew || [];
    const mo = m.minorOld || [];
    if (mn.length && mo.length) parts.push(`${mn.map(name).join(", ")} au lieu de ${mo.map(name).join(", ")}`);
    else if (mn.length) parts.push(`avec ${mn.map(name).join(", ")} en plus`);
    else if (mo.length) parts.push(`sans ${mo.map(name).join(", ")}`);
    return parts.join(" · ");
  }
  // Encadré "doublon de tenue", affiché dans le formulaire en cours (comme pour les vêtements).
  function renderOutfitDupPanel(m, { onView, onForce, forceLabel = "Enregistrer quand même" }) {
    const title = m.kind === "exact" ? `Elle existe déjà : « ${m.outfit.name} »` : m.kind === "twin" ? `Même look que « ${m.outfit.name} »` : `Presque comme « ${m.outfit.name} »`;
    const pieces = itemsForOutfit(m.outfit).slice(0, 4);
    return (
      <div className="p-3 rounded-2xl mb-3 w-full" style={{ background: "#FDE8E5" }}>
        <div className="flex items-center gap-2.5 mb-2">
          <span className="grid overflow-hidden flex-shrink-0" style={{ width: 44, height: 44, borderRadius: 12, gridTemplateColumns: pieces.length > 1 ? "1fr 1fr" : "1fr", gap: 1, background: "#FFFFFF" }}>
            {pieces.map((it) => (
              <span key={it.id} style={{ background: it.photo ? COLORS.haze : it.hex, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
                {it.photo && <img src={thumbOf(it)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
              </span>
            ))}
          </span>
          <div className="min-w-0">
            <p className="text-sm" style={{ fontWeight: 700 }}>{title}</p>
            {m.kind !== "exact" && <p className="text-xs" style={{ color: "#555555" }}>{describeOutfitDiff(m)}</p>}
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onView} className="flex-1 h-10 rounded-full text-sm" style={{ background: "#FFFFFF", fontWeight: 600 }}>Voir</button>
          {m.kind !== "exact" && onForce && (
            <button type="button" onClick={onForce} className="flex-1 h-10 rounded-full text-sm" style={{ background: COLORS.ink, color: "#FFFFFF", fontWeight: 600 }}>{forceLabel}</button>
          )}
        </div>
      </div>
    );
  }

  function commitOutfit() {
    if (!outfitName.trim() || selectedIds.length === 0) return;
    const newOutfit = { id: Date.now(), name: outfitName, itemIds: selectedIds, favorite: false, wornDates: [], ...outfitTags };
    setOutfits((prev) => [...prev, newOutfit]);
    setOutfitName("");
    setSelectedIds([]);
    setOutfitTags(EMPTY_OUTFIT_TAGS);
  }

  // Coche/décoche un tag (saison, météo ou occasion) sur la tenue en cours de création.
  function toggleOutfitTag(field, value) {
    setOutfitTags((prev) => ({
      ...prev,
      [field]: prev[field].includes(value) ? prev[field].filter((v) => v !== value) : [...prev[field], value],
    }));
  }

  // Les 3 rangées de tags affichées au moment d'enregistrer une tenue.
  function renderOutfitTagPicker() {
    const groups = [
      { field: "weather", label: "Météo", values: WEATHER_TAGS },
      { field: "occasions", label: "Occasions", values: OCCASIONS },
    ];
    return (
      <div className="flex flex-col gap-3 mb-4">
        {groups.map((g) => (
          <div key={g.field}>
            <div className="flex gap-1.5 flex-wrap">
              {g.values.map((v) => {
                const active = outfitTags[g.field].includes(v);
                return (
                  <button
                    type="button"
                    key={v}
                    onClick={() => toggleOutfitTag(g.field, v)}
                    className="px-4 h-9 rounded-full text-sm"
                    style={{
                      background: active ? COLORS.ink : "transparent",
                      color: active ? "white" : COLORS.ink,
                      border: `1px solid ${active ? COLORS.ink : COLORS.line}`,
                    }}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function saveOutfit(e, force = false) {
    if (e) e.preventDefault();
    const m = findSimilarOutfit(selectedIds);
    if (m && m.exact) return; // doublon parfait : l'encadré est déjà affiché, rien à enregistrer
    commitOutfit();
    setOutfitDup(null);
    setShowOutfitForm(false);
    showToast({ text: "Tenue enregistrée ✓", action: "Voir", onAction: () => changeView("tenues") });
  }

  function removeOutfit(id) {
    setOutfits((prev) => prev.filter((o) => o.id !== id));
  }

  function toggleFavoriteOutfit(id) {
    setOutfits((prev) => prev.map((o) => (o.id === id ? { ...o, favorite: !o.favorite } : o)));
  }

  // Vrai si cette tenue a déjà été marquée "portée" à un moment de la journée en cours.
  function isWornToday(outfit) {
    const todayStr = new Date().toDateString(); // ex: "Thu Aug 28 2026", ignore l'heure précise
    return (outfit.wornDates || []).some((d) => new Date(d).toDateString() === todayStr);
  }

  // Enlève toute date correspondant à aujourd'hui d'une liste de dates
  // (utilisé pour "déclencher" un marquage fait par erreur).
  function removeTodayEntries(dates) {
    const todayStr = new Date().toDateString();
    return (dates || []).filter((d) => new Date(d).toDateString() !== todayStr);
  }

  // Marque une tenue comme portée aujourd'hui : on note la date sur la tenue,
  // sur chacun des vêtements qui la composent, ET on crée (ou retrouve) l'entrée
  // correspondante dans l'agenda du jour, pour qu'elle apparaisse aussi sur la page Aujourd'hui.
  function markOutfitWorn(outfit) {
    if (isWornToday(outfit)) return; // sécurité en plus du bouton désactivé : jamais deux fois le même jour
    const today = new Date().toISOString();
    setOutfits((prev) => prev.map((o) => (o.id === outfit.id ? { ...o, wornDates: [...(o.wornDates || []), today] } : o)));
    setItems((prev) =>
      prev.map((i) => (outfit.itemIds.includes(i.id) ? { ...i, wornDates: [...(i.wornDates || []), today] } : i))
    );

    // Synchro agenda : si cette tenue n'a pas déjà une entrée aujourd'hui, on l'ajoute.
    // "outfitId" permet de la reconnaître plus tard (pour l'enlever si on décoche).
    setAgenda((prev) => {
      const dayEntries = normalizeDayEntries(prev[todayKey()]);
      const alreadyPlanned = dayEntries.some((e) => e.outfitId === outfit.id);
      if (alreadyPlanned) return prev;
      const newEntry = { id: Date.now(), label: outfit.name, itemIds: outfit.itemIds, outfitId: outfit.id };
      return { ...prev, [todayKey()]: [...dayEntries, newEntry] };
    });
  }

  // L'inverse : retire le marquage "portée aujourd'hui" sur la tenue, ses vêtements,
  // et l'entrée d'agenda qui avait été créée automatiquement pour elle.
  function unmarkOutfitWorn(outfit) {
    setOutfits((prev) => prev.map((o) => (o.id === outfit.id ? { ...o, wornDates: removeTodayEntries(o.wornDates) } : o)));
    setItems((prev) =>
      prev.map((i) => (outfit.itemIds.includes(i.id) ? { ...i, wornDates: removeTodayEntries(i.wornDates) } : i))
    );
    setAgenda((prev) => {
      const dayEntries = normalizeDayEntries(prev[todayKey()]).filter((e) => e.outfitId !== outfit.id);
      const next = { ...prev };
      if (dayEntries.length === 0) delete next[todayKey()];
      else next[todayKey()] = dayEntries;
      return next;
    });
  }

  // Les critères du petit "questionnaire" avant de générer une suggestion.
  // null/"" = le critère n'est pas pris en compte pour cette génération.
  const [currentWeather, setCurrentWeather] = useState(null);
  const [genOccasion, setGenOccasion] = useState(null);
  const [genColorFamily, setGenColorFamily] = useState(null);
  const [genPreference, setGenPreference] = useState(null); // null | "souvent" | "oser"

  // La popup du générateur, en étapes.
  // Si la météo réelle est connue, l'étape "Il fait quel temps ?" est sautée.
  const [wizardSteps, setWizardSteps] = useState(["piece", "meteo", "occasion", "couleur", "preference"]);
  const WIZARD_STEPS = wizardSteps;
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  // La "pièce en tête" : si choisie, elle sera systématiquement incluse dans la suggestion,
  // et les autres pièces seront piochées en priorité parmi celles qui "vont bien avec" elle.
  const [wizardBaseItemId, setWizardBaseItemId] = useState(null);
  // Contrôle l'écran de "composition" puis le résultat affiché dans la popup.
  const [wizardGenerating, setWizardGenerating] = useState(false);
  const [wizardShowResult, setWizardShowResult] = useState(false);
  // Retouche de la tenue générée : null = fermé, un nombre = on remplace la pièce
  // à cette position, "add" = on ajoute une pièce.
  const [wizardSwap, setWizardSwap] = useState(null);
  // Étape "Une pièce en tête ?" : catégorie ouverte (null = liste des catégories).
  const [wizardPieceCat, setWizardPieceCat] = useState(null);
  // Si la suggestion est une tenue déjà enregistrée, son id (sinon null).
  const [wizardFromOutfitId, setWizardFromOutfitId] = useState(null);
  // Météo utilisée par le générateur : celle d'aujourd'hui, ou la prévision de demain.
  const [wizardWeather, setWizardWeather] = useState(null);
  // Météo d'ici pour le jour de la tenue (null si inconnue), et si on l'utilise ou non.
  const [wizardLocalWeather, setWizardLocalWeather] = useState(null);
  const [wizardUseLocalWeather, setWizardUseLocalWeather] = useState(true);

  // Active / désactive la météo automatique dans le générateur (utile pour préparer
  // une tenue pour un autre jour ou un autre endroit : on choisit alors le temps soi-même).
  function toggleWizardLocalWeather() {
    const next = !wizardUseLocalWeather;
    setWizardUseLocalWeather(next);
    if (next && wizardLocalWeather) {
      setWizardWeather(wizardLocalWeather);
      setCurrentWeather(weatherToTag(wizardLocalWeather));
      setWizardSteps(["piece", "occasion", "couleur", "preference"]);
    } else {
      setWizardWeather(null);
      setCurrentWeather(null);
      setWizardSteps(["piece", "meteo", "occasion", "couleur", "preference"]);
    }
  }
  const [wizardAddFilter, setWizardAddFilter] = useState("Tous");

  // Remplace la pièce en position "index" par une autre, ou l'ajoute à la fin.
  // Dès qu'on retouche une tenue existante, elle devient une nouvelle tenue.
  function detachFromExistingOutfit() {
    if (wizardFromOutfitId) {
      setWizardFromOutfitId(null);
      setOutfitName(nextOutfitName());
    }
  }

  function pickWizardItem(itemId) {
    detachFromExistingOutfit();
    if (wizardSwap === "add") {
      setSelectedIds((prev) => [...prev, itemId]);
    } else {
      setSelectedIds((prev) => prev.map((id, i) => (i === wizardSwap ? itemId : id)));
    }
    setWizardSwap(null);
  }

  function removeWizardItem(index) {
    detachFromExistingOutfit();
    setSelectedIds((prev) => prev.filter((_, i) => i !== index));
    setWizardSwap(null);
  }

  // Si non-null, le résultat du générateur sera planifié à cette date au lieu
  // d'être simplement ajouté aux tenues (utilisé depuis la popup rapide de la page Aujourd'hui).
  const [wizardTargetDate, setWizardTargetDate] = useState(null);

  function openWizard(targetDate, baseItemId = null) {
    setWizardSwap(null);
    setWizardBaseItemId(baseItemId); // pas de pièce en tête restée cochée d'une fois sur l'autre (sauf si on en impose une)
    setWizardPieceCat(null);
    // Tenue prévue pour demain → on prend la prévision de demain.
    const dayWeather = targetDate && targetDate === tomorrowKey() && weather && weather.tomorrow ? weather.tomorrow : weather;
    setWizardWeather(dayWeather);
    setWizardLocalWeather(dayWeather);
    setWizardUseLocalWeather(true);
    const autoTag = weatherToTag(dayWeather);
    setCurrentWeather(autoTag || null);
    const steps = autoTag
      ? ["piece", "occasion", "couleur", "preference"]
      : ["piece", "meteo", "occasion", "couleur", "preference"];
    // Pièce déjà choisie (ex. depuis "Redécouvre") : on saute l'étape "Une pièce en tête ?".
    setWizardSteps(baseItemId ? steps.filter((st) => st !== "piece") : steps);
    setWizardStep(0);
    setWizardShowResult(false);
    setWizardTargetDate(targetDate || null);
    setShowWizard(true);
  }

  // Traduit la météo réelle (Open-Meteo) en tag : pluie d'abord, sinon selon la
  // température maximale de la journée. Renvoie null si la météo n'est pas disponible.
  function isRainCode(code) {
    return code != null && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95);
  }
  // Pluie s'il pleut maintenant, OU si la pluie est prévue dans la journée
  // (temps dominant pluvieux, ou au moins 50 % de risque).
  function isRainyDay(w) {
    if (!w) return false;
    return isRainCode(w.code) || isRainCode(w.dailyCode) || (w.rainChance != null && w.rainChance >= 50);
  }
  function weatherToTag(w) {
    if (!w) return null;
    if (w.max > 25) return "Chaud";
    if (w.max >= 20) return "Doux";
    if (w.max >= 14) return "Frais";
    return "Froid";
  }

  function wizardNext() {
    setWizardStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
  }

  function wizardBack() {
    setWizardStep((s) => Math.max(s - 1, 0));
  }

  // Pioche un vêtement dans une catégorie, en tenant compte de tous les critères choisis
  // et de la pièce en tête si une a été choisie.
  // "optional" : pour les pièces facultatives (couche, veste, accessoire). Si aucune
  // ne respecte la palette de couleurs, on préfère ne rien ajouter plutôt que de casser l'harmonie.
  // "prefOverride" : impose une préférence pour cette catégorie seulement
  // (sert à glisser une pièce phare dans une tenue "Oser du neuf").
  // "avoid" : pièces de la suggestion précédente, à éviter quand on régénère.
  function randomFrom(category, colorAnchor, optional = false, prefOverride, avoid = new Set(), noPattern = false) {
    const baseItem = wizardBaseItemId ? items.find((i) => i.id === wizardBaseItemId) : null;
    if (baseItem && effectiveCategory(baseItem) === category) return baseItem; // la pièce en tête est toujours incluse

    let pool = items.filter((i) => effectiveCategory(i) === category);
    if (pool.length === 0) return undefined;

    // Règle "un seul motif par tenue" : s'il y a déjà une pièce à motifs, on prend une pièce unie.
    if (noPattern) {
      const plain = pool.filter((i) => !isPatterned(i));
      if (plain.length > 0) pool = plain;
      else if (optional) return undefined; // pièce facultative : mieux vaut s'en passer
    }

    // Priorité aux pièces liées ("va bien avec") à la pièce en tête, si elle en a dans cette catégorie.
    if (baseItem) {
      const paired = pool.filter((i) => (baseItem.pairsWith || []).includes(i.id));
      if (paired.length > 0) pool = paired;
    }

    if (currentWeather) {
      const filtered = pool.filter((i) => (i.weather || []).includes(currentWeather));
      if (filtered.length > 0) pool = filtered;
    }
    if (genOccasion) {
      const filtered = pool.filter((i) => (i.occasions || []).includes(genOccasion));
      if (filtered.length > 0) pool = filtered;
    }
    if (genColorFamily) {
      // Famille choisie dans le questionnaire : d'abord cette famille, sinon du neutre
      // (noir, blanc, beige… qui vont avec tout). Jamais une autre couleur à la place.
      const same = pool.filter((i) => itemHasFamily(i, genColorFamily));
      const neutral = pool.filter((i) => hexToColorFamily(i.hex) === "Neutres");
      if (same.length > 0) pool = same;
      else if (neutral.length > 0) pool = neutral;
      else if (optional) return undefined;
    } else if (colorAnchor) {
      // Sans choix explicite, on garde la cohérence avec la première pièce colorée :
      // soit la même famille de couleur, soit du neutre.
      const filtered = pool.filter((i) => {
        const fam = hexToColorFamily(i.hex);
        if (itemHasFamily(i, colorAnchor)) return true; // une de ses couleurs (motif) s'accorde
        return fam === colorAnchor || fam === "Neutres";
      });
      if (filtered.length > 0) pool = filtered;
      else if (optional) return undefined;
    }

    // Régénérer : on écarte la pièce proposée juste avant, s'il existe une autre possibilité.
    const fresh = pool.filter((i) => !avoid.has(i.id));
    if (fresh.length > 0) pool = fresh;

    // Préférence : plutôt des habitués, ou plutôt des vêtements délaissés qu'on "ose" ressortir.
    const pref = prefOverride !== undefined ? prefOverride : genPreference;
    if (pref === "souvent") {
      const sorted = [...pool].sort((a, b) => itemWornDays(b).length - itemWornDays(a).length);
      pool = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2))); // la moitié la plus portée
    } else if (pref === "oser") {
      const sorted = [...pool].sort((a, b) => itemWornDays(a).length - itemWornDays(b).length);
      pool = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2))); // la moitié la moins portée
    }

    return pool[Math.floor(Math.random() * pool.length)];
  }

  // "Vêtements souvent portés" : cherche parmi tes tenues déjà enregistrées une qui
  // respecte les critères (pièce en tête, météo, occasion, couleurs), en privilégiant
  // les plus portées. Renvoie null si aucune ne convient.
  function pickExistingOutfit(baseItem, avoid = new Set()) {
    let pool = outfits.filter((o) => {
      const pieces = itemsForOutfit(o);
      return pieces.length >= 2 && pieces.length === o.itemIds.length; // tenue complète (aucune pièce supprimée)
    });
    // Pas une tenue déjà portée ces 7 derniers jours : on évite de remettre toujours la même.
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    pool = pool.filter((o) => !outfitWornDays(o).some((d) => new Date(d).getTime() > weekAgo));
    if (baseItem) pool = pool.filter((o) => o.itemIds.includes(baseItem.id));
    // Régénérer : pas la même tenue que celle proposée juste avant.
    pool = pool.filter((o) => !(o.itemIds.length > 0 && o.itemIds.every((id) => avoid.has(id))));
    if (currentWeather) pool = pool.filter((o) => (o.weather || []).includes(currentWeather));
    if (genOccasion) pool = pool.filter((o) => (o.occasions || []).includes(genOccasion));
    if (genColorFamily) {
      pool = pool.filter((o) => {
        const pieces = itemsForOutfit(o);
        const fams = pieces.map((i) => hexToColorFamily(i.hex));
        return pieces.some((i) => itemHasFamily(i, genColorFamily)) && pieces.every((i) => itemHasFamily(i, genColorFamily) || fams[pieces.indexOf(i)] === "Neutres");
      });
    }
    if (pool.length === 0) return null;
    const sorted = [...pool].sort((a, b) => outfitWornDays(b).length - outfitWornDays(a).length);
    const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2))); // la moitié la plus portée
    return top[Math.floor(Math.random() * top.length)];
  }

  // ── Règles de mode (réglables dans les Paramètres) ──
  // Renvoie le nombre de règles non respectées par une tenue (0 = parfaite).
  const NEUTRAL_NAMES = ["Noir", "Blanc", "Blanc cassé", "Gris", "Beige"];
  function outfitRuleViolations(pieces) {
    let v = 0;
    const main = pieces.filter((i) => !["Chaussures", "Accessoire"].includes(effectiveCategory(i)));
    const extra = pieces.filter((i) => ["Chaussures", "Accessoire"].includes(effectiveCategory(i)));
    const names = (list) => new Set(list.flatMap(itemColors).map(hexToColorName));
    // 1. Pas plus de 3 couleurs (les neutres ne comptent pas)
    if (genRules.max3Colors) {
      const colored = [...names(pieces)].filter((n) => !NEUTRAL_NAMES.includes(n));
      if (colored.length > 3) v++;
    }
    // 2. Une seule pièce de couleur vive
    if (genRules.oneBold) {
      const bold = pieces.filter((i) => { const { s: sat, l } = hexToHsl(i.hex); return sat >= 0.55 && l > 0.3 && l < 0.72; });
      if (bold.length > 1) v++;
    }
    // 3. Rappel de couleur : chaussures ou accessoire reprennent une couleur du haut / bas / robe / veste
    if (genRules.colorRecall && extra.length && main.length) {
      const mainNames = names(main);
      if (![...names(extra)].some((n) => mainNames.has(n))) v++;
    }
    // 4. Contraste clair / foncé (sauf ton sur ton : tout de la même couleur)
    if (genRules.contrast && main.length >= 2) {
      const ls = main.map((i) => hexToHsl(i.hex).l);
      const tonSurTon = new Set(main.map((i) => hexToColorName(i.hex))).size === 1;
      if (!tonSurTon && Math.max(...ls) - Math.min(...ls) < 0.25) v++;
    }
    // 5. La vieille école : pas de noir avec du bleu marine, ni de noir avec du marron
    if (genRules.oldSchool) {
      const all = names(pieces);
      if (all.has("Noir") && (all.has("Marine") || all.has("Marron"))) v++;
    }
    return v;
  }

  // On compose jusqu'à 40 tenues au hasard et on garde la première qui respecte toutes les règles
  // (ou, à défaut, celle qui en enfreint le moins).
  function suggestOutfit(avoidIds = [], attempt = 0, best = null) {
    const avoid = new Set(avoidIds);
    const baseItem = wizardBaseItemId ? items.find((i) => i.id === wizardBaseItemId) : null;
    setWizardFromOutfitId(null);

    // Habituée : environ 3 fois sur 10, on ressort une de tes tenues existantes (si une convient).
    // Le reste du temps, on compose une nouvelle tenue avec tes pièces les plus portées.
    if (genPreference === "souvent" && Math.random() < 0.3) {
      const existing = pickExistingOutfit(baseItem, avoid);
      if (existing) {
        setSelectedIds(existing.itemIds);
        setOutfitName(existing.name);
        setOutfitTags({ weather: existing.weather || [], occasions: existing.occasions || [] });
        setWizardFromOutfitId(existing.id);
        return;
      }
    }

    // "L'ancre couleur" : la famille de la première pièce COLORÉE choisie (une pièce
    // neutre va avec tout, elle ne fixe donc pas la palette). Les pièces suivantes sont
    // piochées dans cette même famille ou en neutre.
    let colorAnchor = null;
    // "Oser du neuf" : une seule pièce phare (parmi tes plus portées) pour garder un repère,
    // tout le reste en pièces peu portées. Pas besoin si tu as déjà choisi une pièce en tête.
    let starCat = null;
    // Déjà une pièce à motifs dans la tenue ? (les accessoires ne comptent pas)
    let hasPattern = !!(baseItem && effectiveCategory(baseItem) !== "Accessoire" && isPatterned(baseItem));
    function pick(category, optional = false) {
      const noPattern = genRules.onePattern && hasPattern && category !== "Accessoire";
      const item = randomFrom(category, colorAnchor, optional, category === starCat ? "souvent" : undefined, avoid, noPattern);
      if (item && category !== "Accessoire" && isPatterned(item)) hasPattern = true;
      if (item && !colorAnchor && !genColorFamily) {
        const fam = hexToColorFamily(item.hex);
        if (fam !== "Neutres") colorAnchor = fam;
      }
      return item;
    }

    // Niveau de température du jour : "Chaud", "Doux", "Frais", "Froid", ou null si inconnu.
    // Par temps de pluie, on se base sur la température réelle si on la connaît.
    const rainy = isRainyDay(wizardWeather);
    let tempLevel = null;
    if (["Chaud", "Doux", "Frais", "Froid"].includes(currentWeather)) tempLevel = currentWeather;
    else if (wizardWeather) tempLevel = wizardWeather.max > 25 ? "Chaud" : wizardWeather.max >= 20 ? "Doux" : wizardWeather.max >= 14 ? "Frais" : "Froid";
    // Au-delà de 25 °C, plus de veste ni de chemise par-dessus.
    const tooHot = wizardWeather ? wizardWeather.max > 25 : currentWeather === "Chaud";
    // Gros écart entre le matin et l'après-midi (8 °C ou plus, avec un matin sous 15 °C) :
    // on prévoit une veste à retirer dans la journée, même si l'après-midi est doux.
    const bigSwing = wizardWeather ? wizardWeather.max - wizardWeather.min >= 8 && wizardWeather.min < 15 : false;

    let base;
    let isDress = false;
    if (baseItem && effectiveCategory(baseItem) === "Robe") {
      base = [baseItem];
      isDress = true;
      const fam = hexToColorFamily(baseItem.hex);
      if (!genColorFamily && fam !== "Neutres") colorAnchor = fam;
    } else {
      // Une fois sur trois environ, on part sur une robe plutôt que haut + bas séparés
      // (si le dressing en contient au moins une, sinon on retombe sur haut + bas) —
      // sauf si la pièce en tête est justement un haut ou un bas, auquel cas on la respecte.
      const forceTopBottom = baseItem && (effectiveCategory(baseItem) === "Haut" || effectiveCategory(baseItem) === "Bas");
      const tryDress = !forceTopBottom && Math.random() < 0.33 && items.some((i) => effectiveCategory(i) === "Robe");
      isDress = tryDress;
      if (genPreference === "oser" && !baseItem) {
        const slots = tryDress ? ["Robe", "Chaussures"] : ["Haut", "Bas", "Chaussures"];
        starCat = slots[Math.floor(Math.random() * slots.length)];
      }
      base = tryDress ? [pick("Robe")] : [pick("Haut"), pick("Bas")];
    }

    const picks = [...base, pick("Chaussures")];
    const forceInclude = (cat) => baseItem && effectiveCategory(baseItem) === cat;

    // ── Couche par-dessus le haut (pull OU chemise ouverte), selon la température ──
    //   Chaud (+25 °C) : aucune · Doux (20-25 °C) : parfois une chemise (pas de pull)
    //   Frais (14-19 °C) : une fois sur deux environ · Froid : un pull
    //   Avec une robe : seulement un pull, et seulement s'il fait froid.
    //   Météo inconnue : une fois sur deux, comme avant.
    let layer = null;
    if (forceInclude("Pull")) layer = "Pull";
    else if (forceInclude("Chemise")) layer = "Chemise";
    else if (isDress) layer = tempLevel === "Froid" ? "Pull" : null;
    else if (tempLevel === "Froid") layer = "Pull";
    else if (tempLevel === "Chaud") layer = null;
    else if (tempLevel === "Doux") layer = Math.random() < 0.5 ? "Chemise" : null;
    else if (tempLevel === "Frais") layer = Math.random() < 0.6 ? (Math.random() < 0.5 ? "Pull" : "Chemise") : null;
    else if (tempLevel === null) layer = Math.random() < 0.5 ? null : Math.random() < 0.5 ? "Pull" : "Chemise";
    if (layer) {
      const forced = forceInclude(layer);
      let layerItem = pick(layer, !forced);
      // Si la catégorie tirée est vide (ou hors palette), on essaie l'autre — sauf avec une robe.
      if (!layerItem && !forced && !isDress) layerItem = pick(layer === "Pull" ? "Chemise" : "Pull", true);
      if (layerItem) picks.push(layerItem);
    }

    // ── Veste : jamais au-delà de 25 °C (sauf pluie), toujours quand il fait froid ou qu'il pleut ──
    let wantJacket;
    if (forceInclude("Veste") || rainy || bigSwing || tempLevel === "Froid" || tempLevel === "Frais") wantJacket = true; // toujours sous 20 °C, s'il pleut, ou si le matin est frais
    else if (tooHot) wantJacket = false;
    else wantJacket = Math.random() < 0.5; // doux (20-25 °C), ou météo inconnue
    if (wantJacket) picks.push(pick("Veste", !forceInclude("Veste")));

    // ── Accessoire : une fois sur deux, s'il s'accorde aux couleurs ──
    if (forceInclude("Accessoire") || Math.random() > 0.5) picks.push(pick("Accessoire", !forceInclude("Accessoire")));
    let found = picks.filter(Boolean);
    const violations = outfitRuleViolations(found);
    const candidate = { found, violations };
    const keep = !best || violations < best.violations ? candidate : best;
    if (violations > 0 && attempt < 40) return suggestOutfit(avoidIds, attempt + 1, keep);
    found = keep.found;
    setSelectedIds(found.map((i) => i.id));
    setOutfitName(found.length >= 2 ? nextOutfitName() : "");
    // Tombé pile sur une tenue déjà enregistrée ? On le signale (badge "Une de tes tenues").
    const same = findSimilarOutfit(found.map((i) => i.id));
    if (same && same.exact) { setWizardFromOutfitId(same.outfit.id); setOutfitName(same.outfit.name); }
    // On pré-coche les tags de la tenue avec les critères utilisés pour la générer.
    setOutfitTags({ weather: currentWeather ? [currentWeather] : [], occasions: genOccasion ? [genOccasion] : [] });
  }

  // Lance la génération avec les critères choisis, puis ferme la popup et ouvre
  // le formulaire de création pour que tu puisses ajuster et enregistrer.
  function wizardGenerate() {
    // Si une tenue est déjà affichée, c'est "Régénérer" : on évite de reproposer ses pièces.
    const avoidIds = wizardShowResult ? selectedIds : [];
    setWizardSwap(null);
    setWizardGenerating(true);
    setWizardShowResult(false);
    // Petit délai volontaire, juste pour que la génération se "ressente"
    // plutôt que le résultat apparaisse d'un coup sec.
    setTimeout(() => {
      suggestOutfit(avoidIds);
      setWizardGenerating(false);
      setWizardShowResult(true);
    }, 700);
  }

  // Enregistre directement la tenue affichée en résultat, puis referme toute la popup.
  function wizardSaveOutfit(force = false) {
    if (wizardTargetDate) {
      planItemsOnDate(wizardTargetDate, selectedIds, outfitName, wizardFromOutfitId || undefined);
    } else if (wizardFromOutfitId) {
      // Tenue déjà enregistrée : pas de doublon, on ouvre simplement sa fiche.
      changeView("tenues");
      setDetailOutfitId(wizardFromOutfitId);
    } else {
      const m = findSimilarOutfit(selectedIds);
      if (m && m.exact) {
        changeView("tenues");
        setDetailOutfitId(m.outfit.id);
      } else {
        commitOutfit();
        showToast({ text: "Tenue enregistrée ✓", action: "Voir", onAction: () => changeView("tenues") });
      }
    }
    setShowWizard(false);
    setWizardShowResult(false);
    setWizardTargetDate(null);
  }

  function itemsForOutfit(outfit) {
    return outfit.itemIds.map((id) => items.find((i) => i.id === id)).filter(Boolean);
  }

  // ── Page Tenues : rangées automatiques selon la météo ──
  const WEATHER_ROW_TITLES = { Chaud: "Pour le chaud", Doux: "Pour les jours doux", Frais: "Pour le frais", Froid: "Pour le froid" };
  const outfitsByRecent = [...outfits].sort((a, b) => b.id - a.id);
  const todayOutfitTag = weatherToTag(weather); // "Doux", "Frais"… ou null si météo inconnue
  const outfitGroups = [
    ...WEATHER_TAGS.map((w) => ({ key: w, title: WEATHER_ROW_TITLES[w] || w, list: outfitsByRecent.filter((o) => (o.weather || []).includes(w)) })),
    // En dernier, toutes les tenues (y compris celles sans tag météo).
    { key: "toutes", title: "Toutes mes tenues", list: outfitsByRecent },
  ].filter((g) => g.list.length > 0);
  const todayOutfits = todayOutfitTag ? outfitsByRecent.filter((o) => (o.weather || []).includes(todayOutfitTag)) : [];

  // Toutes les tenues, filtrées par les tags cochés : dans un même groupe (météo, occasion),
  // il suffit d'un tag en commun ; entre groupes, il faut respecter chacun.
  const outfitQ = normalizeName(outfitQuery);
  const hasOutfitFilter = outfitTagFilter.fav || outfitTagFilter.weather.length > 0 || outfitTagFilter.occasions.length > 0 || !!outfitQ;
  const filteredOutfits = outfitsByRecent.filter((o) => {
    // Recherche : dans le nom de la tenue ou dans le nom de ses pièces
    if (outfitQ && !normalizeName(o.name).includes(outfitQ) && !(o.itemIds || []).some((id) => normalizeName((items.find((i) => i.id === id) || {}).name).includes(outfitQ))) return false;
    if (outfitTagFilter.fav && !o.favorite) return false;
    if (outfitTagFilter.weather.length > 0 && !outfitTagFilter.weather.some((w) => (o.weather || []).includes(w))) return false;
    if (outfitTagFilter.occasions.length > 0 && !outfitTagFilter.occasions.some((x) => (o.occasions || []).includes(x))) return false;
    return true;
  });
  function toggleOutfitFilter(group, value) {
    setOutfitTagFilter((prev) =>
      group === "fav"
        ? { ...prev, fav: !prev.fav }
        : { ...prev, [group]: prev[group].includes(value) ? prev[group].filter((v) => v !== value) : [...prev[group], value] }
    );
  }

  // Vignette d'une tenue : ses pièces en mosaïque 2×2, son nom dessous, un cœur si favorite.
  // Palette d'une tenue : les couleurs de ses pièces (5 max, sans doublon).
  function outfitPalette(outfit) {
    return [...new Set(itemsForOutfit(outfit).flatMap(itemColors).map((h) => h.toLowerCase()))].slice(0, 5);
  }

  // Petites pastilles de couleur qui se chevauchent (palette d'une tenue ou du jour).
  function renderPaletteDots(colors, dot = 12, ring = "#FFFFFF") {
    return (
      <span className="flex flex-shrink-0" style={{ paddingLeft: Math.round(dot / 3) }}>
        {colors.map((hex) => (
          <span key={hex} style={{ width: dot, height: dot, borderRadius: dot / 2, background: hex, border: "1px solid rgba(0,0,0,0.1)", marginLeft: -Math.round(dot / 3), boxShadow: `0 0 0 1.5px ${ring}` }} />
        ))}
      </span>
    );
  }

  // "onPick" : action au toucher (par défaut, ouvrir la fiche de la tenue).
  function renderOutfitTile(outfit, size, onPick) {
    const pieces = itemsForOutfit(outfit).slice(0, 4);
    return (
      <button
        type="button"
        key={outfit.id}
        onClick={() => (onPick ? onPick(outfit) : setDetailOutfitId(outfit.id))}
        className="flex-shrink-0 text-left"
        style={{ width: size || "100%" }}
      >
        <div
          className="relative overflow-hidden"
          style={{
            width: size || "100%",
            height: size || "auto",
            aspectRatio: size ? undefined : "1 / 1",
            borderRadius: 16,
            background: COLORS.haze,
            display: "grid",
            gridTemplateColumns: pieces.length > 1 ? "1fr 1fr" : "1fr",
            gridTemplateRows: pieces.length > 2 ? "1fr 1fr" : "1fr",
            gap: pieces.length > 1 ? 2 : 0,
          }}
        >
          {pieces.map((item) =>
            item.photo ? (
              <img key={item.id} src={thumbOf(item)} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", minWidth: 0, minHeight: 0 }} />
            ) : (
              <div key={item.id} style={{ background: item.hex, minWidth: 0, minHeight: 0 }} />
            )
          )}
          {outfit.favorite && (
            <Heart size={15} color={COLORS.rose} fill={COLORS.rose} style={{ position: "absolute", top: 7, right: 7, filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }} />
          )}
        </div>
        <span className="flex items-center justify-between gap-2 mt-1.5">
          <span className="text-sm truncate" style={{ fontWeight: 600 }}>{outfit.name}</span>
          {renderPaletteDots(outfitPalette(outfit), 11)}
        </span>
      </button>
    );
  }

  const visibleOutfits = outfits
    .filter((o) => !favoritesOnly || o.favorite)
    .filter((o) => outfitWeatherFilter === "Tous" || (o.weather || []).includes(outfitWeatherFilter))
    .filter((o) => outfitOccasionFilter === "Tous" || (o.occasions || []).includes(outfitOccasionFilter))
    // Les tenues les plus récentes en premier (l'id est la date de création).
    .sort((a, b) => b.id - a.id);

  // ── ACTIONS SUR L'AGENDA ─────────────────────
  // Date du jour au format "AAAA-MM-JJ", pour comparer facilement avec les clés de l'agenda.
  // Demande la position, puis va chercher la météo du jour via Open-Meteo
  // (service gratuit, sans clé ni compte). Appelée au démarrage et rejouable
  // via le bouton "Activer la météo" si la personne avait d'abord refusé.
  // Enregistre le prénom saisi à l'écran de bienvenue, une fois pour toutes sur cet appareil.
  function saveUserName() {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    localStorage.setItem("mon-armoire-username", trimmed);
    setUserName(trimmed);
  }

  function requestWeather() {
    if (!navigator.geolocation) {
      setWeatherStatus("error");
      return;
    }
    setWeatherStatus("loading");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&forecast_days=3&timezone=auto`
          );
          const data = await res.json();
          // Matin / midi / soir : températures prévues à 9 h, 13 h et 19 h aujourd'hui.
          const hourAt = (h) => data.hourly && data.hourly.temperature_2m && data.hourly.temperature_2m[h] != null
            ? { temp: Math.round(data.hourly.temperature_2m[h]), code: data.hourly.weather_code ? data.hourly.weather_code[h] : null }
            : null;
          // Nom de la ville (facultatif : si ça échoue, on n'affiche simplement pas la ville).
          fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=fr`)
            .then((r) => r.json())
            .then((g) => { const city = g.city || g.locality; if (city) setWeatherCity(city); })
            .catch(() => {});
          setWeather({
            hours: { matin: hourAt(9), midi: hourAt(13), soir: hourAt(19) },
            temp: Math.round(data.current.temperature_2m),
            min: Math.round(data.daily.temperature_2m_min[0]),
            max: Math.round(data.daily.temperature_2m_max[0]),
            code: data.current.weather_code,
            // Prévision pour toute la journée : risque de pluie (%) et temps dominant.
            rainChance: data.daily.precipitation_probability_max ? data.daily.precipitation_probability_max[0] : null,
            dailyCode: data.daily.weather_code ? data.daily.weather_code[0] : null,
            // Prévision de demain (même forme, pour la page Aujourd'hui et le générateur).
            tomorrow: data.daily.temperature_2m_max.length > 1 ? {
              min: Math.round(data.daily.temperature_2m_min[1]),
              max: Math.round(data.daily.temperature_2m_max[1]),
              code: data.daily.weather_code ? data.daily.weather_code[1] : null,
              dailyCode: data.daily.weather_code ? data.daily.weather_code[1] : null,
              rainChance: data.daily.precipitation_probability_max ? data.daily.precipitation_probability_max[1] : null,
            } : null,
          });
          setWeatherStatus("granted");
        } catch {
          setWeatherStatus("error");
        }
      },
      () => setWeatherStatus("denied"),
      { timeout: 8000 }
    );
  }

  // Formate la date du jour pour l'en-tête de la page Aujourd'hui (ex: "samedi 29 août").
  // Traduit un code météo (norme WMO, utilisée par Open-Meteo) en texte lisible + icône.
  // Petite ligne météo pour "Et demain ?" : icône, temps, min/max et risque de pluie.
  function renderTomorrowForecast() {
    const t = weather && weather.tomorrow;
    if (!t) return null;
    const { label, Icon } = getWeatherInfo(t.code);
    return (
      <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: COLORS.ink, opacity: 0.75 }}>
        <Icon size={13} color={COLORS.rose} />
        {label ? `${label} · ` : ""}{t.min}° / {t.max}°
        {t.rainChance != null && t.rainChance >= 30 ? ` · pluie ${t.rainChance} %` : ""}
      </p>
    );
  }

  function getWeatherInfo(code) {
    if (code === 0) return { label: "Ciel dégagé", Icon: Sun };
    if (code <= 2) return { label: "Partiellement nuageux", Icon: Cloud };
    if (code === 3) return { label: "Couvert", Icon: Cloud };
    if (code === 45 || code === 48) return { label: "Brouillard", Icon: CloudFog };
    if (code >= 51 && code <= 67) return { label: "Pluie", Icon: CloudRain };
    if (code >= 71 && code <= 77) return { label: "Neige", Icon: CloudSnow };
    if (code >= 80 && code <= 82) return { label: "Averses", Icon: CloudRain };
    if (code === 85 || code === 86) return { label: "Averses de neige", Icon: CloudSnow };
    if (code >= 95) return { label: "Orage", Icon: CloudLightning };
    return { label: "", Icon: Cloud };
  }

  // Dégradé de la bannière de la page Aujourd'hui, fabriqué à partir des couleurs des vêtements
  // prévus aujourd'hui. Corail uni si rien n'est encore planifié.
  // Vignettes des pièces d'une tenue (sans nom), cliquables : ouvrent la fiche par-dessus.
  function renderPieceThumbs(pieces, cols = 5) {
    return (
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {pieces.map((item) => (
          <button key={item.id} type="button" onClick={() => setDetailItemId(item.id)} aria-label={item.name} className="rounded-xl overflow-hidden" style={{ background: item.photo ? COLORS.haze : item.hex, aspectRatio: "1 / 1" }}>
            {item.photo && <img loading="lazy" decoding="async" src={thumbOf(item)} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
          </button>
        ))}
      </div>
    );
  }

  // Photos du Carnet, de la plus récente à la plus ancienne (même ordre que la grille).
  function carnetShots() {
    return agendaEntries.filter((e) => e.wornPhoto).sort((a, b) => b.dateStr.localeCompare(a.dateStr) || String(b.entryId).localeCompare(String(a.entryId)));
  }

  // Palette d'une ou plusieurs tenues de l'agenda (couleurs des pièces, sans doublon).
  function entriesPalette(entries, max = 5) {
    return [...new Set(entries.flatMap((e) => e.planItems).flatMap(itemColors).map((h) => h.toLowerCase()))].slice(0, max);
  }

  // "Palette du jour" : les couleurs des vêtements prévus aujourd'hui (5 max, sans doublon).
  function todayPalette() {
    const todayItems = todayEntries.flatMap((e) => e.planItems).filter(Boolean);
    return [...new Set(todayItems.flatMap(itemColors).map((h) => h.toLowerCase()))].slice(0, 5);
  }

  // Petite phrase de conseil sous la météo, selon l'écart de température et la pluie.
  function weatherAdvice(w) {
    if (!w) return "";
    const swing = w.max - w.min;
    if (isRainyDay(w)) return "Pluie prévue : prends une veste ou un imper.";
    if (swing >= 8 && w.min < 15) return "Frais ce matin, plus doux ensuite : prévois une veste que tu peux enlever.";
    if (w.max > 25) return "Grosse chaleur : matières légères, pas besoin de veste.";
    if (w.max >= 20) return "Temps doux : une chemise ou une veste légère suffit.";
    if (w.max >= 14) return "Temps frais : ajoute une couche, et une veste.";
    return "Il fait froid : pull chaud et veste de rigueur.";
  }

  // Dernière date de port d'un vêtement (en millisecondes), 0 s'il n'a jamais été porté.
  function lastWornTime(item) {
    const d = itemWornDays(item);
    return d.length ? new Date(d[d.length - 1]).getTime() : 0;
  }

  // "Redécouvre" : les pièces oubliées (pas portées depuis 30 jours, ou jamais),
  // les plus oubliées d'abord, sans celles que l'on a mises de côté ("Pas celle-là").
  const rediscoverPool = (() => {
    const now = Date.now();
    const monthAgo = now - 30 * 24 * 3600 * 1000;
    return items
      .filter((i) => lastWornTime(i) < monthAgo)
      .filter((i) => !(rediscoverHidden[i.id] && new Date(rediscoverHidden[i.id]).getTime() > now))
      .sort((a, b) => lastWornTime(a) - lastWornTime(b) || String(a.id).localeCompare(String(b.id)));
  })();
  const rediscoverItem = rediscoverPool.length ? rediscoverPool[rediscoverSkip % rediscoverPool.length] : null;

  // Cache une pièce de "Redécouvre" pendant 30 jours (mémorisé sur cet appareil).
  function hideRediscover(itemId) {
    const until = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    setRediscoverHidden((prev) => {
      const next = { ...prev, [itemId]: until };
      try { localStorage.setItem("mon-armoire-rediscover-hidden", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // "Dernière sortie il y a 3 mois" / "Jamais portée"
  function rediscoverSubtitle(item) {
    const t = lastWornTime(item);
    if (!t) return "Jamais portée";
    const days = Math.floor((Date.now() - t) / (24 * 3600 * 1000));
    if (days < 60) return `Dernière sortie il y a ${Math.round(days / 7)} semaines`;
    if (days < 365) return `Dernière sortie il y a ${Math.round(days / 30)} mois`;
    return "Dernière sortie il y a plus d'un an";
  }

  // "Ta semaine" : du lundi au dimanche, les pièces portées chaque jour
  // (ou, à défaut, la tenue prévue ce jour-là dans l'agenda).
  function weekDays() {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7), 12);
    const letters = ["L", "M", "M", "J", "V", "S", "D"];
    return letters.map((letter, i) => {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i, 12);
      const key = d.toISOString().slice(0, 10);
      const dayStr = d.toDateString();
      const worn = items.filter((it) => itemWornDays(it).includes(key) || (it.wornDates || []).some((x) => new Date(x).toDateString() === dayStr));
      const planned = agendaEntries.filter((e) => e.dateStr === key);
      return {
        key, letter,
        isToday: dayStr === now.toDateString(),
        worn,
        planned,
        shown: worn.length ? worn : planned.length ? planned[0].planItems : [],
      };
    });
  }

  // Petite mosaïque (2×2) de vêtements, pour les jours de "Ta semaine".
  function renderMiniMosaic(list, size, faded) {
    const shown = list.slice(0, 4);
    return (
      <div style={{ width: size, height: size, borderRadius: 10, overflow: "hidden", display: "grid", gridTemplateColumns: shown.length > 1 ? "1fr 1fr" : "1fr", gridTemplateRows: shown.length > 2 ? "1fr 1fr" : "1fr", gap: 1, background: "#FFFFFF", opacity: faded ? 0.5 : 1 }}>
        {shown.map((item) => (
          <div key={item.id} style={{ background: COLORS.haze, minWidth: 0, minHeight: 0 }}>
            {item.photo ? (
              <img loading="lazy" decoding="async" src={thumbOf(item)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            ) : (
              <div style={{ width: "100%", height: "100%", background: item.hex }} />
            )}
          </div>
        ))}
      </div>
    );
  }

  // "Flat lay" : les pièces de la tenue posées en éventail sur fond blanc, comme sur un lit.
  // Positions (en %) : gauche, haut, largeur, hauteur, rotation.
  const FLATLAY_LAYOUTS = {
    1: [[18, 6, 64, 88, 0]],
    2: [[5, 6, 50, 72, -3], [46, 22, 49, 72, 3]],
    3: [[4, 4, 50, 56, -3], [50, 8, 46, 52, 3], [26, 52, 44, 44, -1]],
    4: [[4, 4, 47, 50, -3], [51, 3, 45, 48, 3], [7, 53, 42, 43, 2], [52, 52, 43, 44, -2]],
    5: [[4, 4, 44, 48, -3], [50, 3, 46, 44, 3], [4, 54, 34, 42, 2], [36, 50, 30, 38, -2], [66, 50, 31, 44, 3]],
    6: [[3, 4, 32, 44, -3], [35, 3, 31, 44, 2], [67, 5, 30, 42, -2], [3, 52, 32, 44, 2], [35, 51, 31, 44, -2], [67, 52, 30, 43, 3]],
  };
  // Tenue avec des pièces détourées : on les pose en "silhouette" et elles se chevauchent,
  // comme une vraie tenue étalée sur un lit (veste derrière, haut sur le bas, chaussures en bas…).
  // Positions en % : gauche, haut, largeur, hauteur, rotation, profondeur (z).
  const SILHOUETTE_SLOTS = {
    Veste: [6, 5, 50, 56, -6, 1],
    Haut: [28, 3, 48, 44, 2, 3],
    Chemise: [28, 3, 48, 46, 2, 3],
    Pull: [28, 3, 48, 46, 2, 3],
    Robe: [26, 3, 50, 74, 1, 3],
    Bas: [30, 32, 42, 62, -2, 2],
    Chaussures: [64, 68, 32, 28, 8, 4],
    Accessoire: [5, 64, 28, 30, -8, 4],
  };
  function renderSilhouette(list, height) {
    const used = {};
    return (
      <div style={{ position: "relative", height, borderRadius: 18, background: "#FFFFFF", overflow: "hidden" }}>
        {list.map((item) => {
          const cat = effectiveCategory(item);
          const base = SILHOUETTE_SLOTS[cat] || SILHOUETTE_SLOTS.Accessoire;
          // Deuxième pièce de la même catégorie : légèrement décalée pour qu'on voie les deux.
          const n = used[cat] = (used[cat] || 0) + 1;
          const [l, t, w, h, r, z] = base;
          const shift = (n - 1) * 14;
          const cut = isCutout(item);
          return (
            <div
              key={item.id}
              style={{
                position: "absolute", left: `${Math.min(l + shift, 100 - w)}%`, top: `${t + (n - 1) * 6}%`, width: `${w}%`, height: `${h}%`,
                transform: `rotate(${r + (n - 1) * 6}deg)`, zIndex: z * 10 + n,
                ...(cut ? {} : { borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 14px rgba(0,0,0,0.12)", background: item.hex }),
              }}
            >
              {item.photo && (
                <img
                  loading="lazy"
                  decoding="async"
                  src={item.photo}
                  alt={item.name}
                  style={cut
                    ? { width: "100%", height: "100%", objectFit: "contain", display: "block", filter: "drop-shadow(0 5px 8px rgba(0,0,0,0.2))" }
                    : { width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  function renderFlatLay(planItems, height) {
    const order = (i) => CATEGORIES.indexOf(i.category);
    const list = [...planItems].sort((a, b) => order(a) - order(b)).slice(0, 6);
    // Au moins la moitié des pièces détourées → version "silhouette" qui se chevauche.
    if (list.filter(isCutout).length * 2 >= list.length) return renderSilhouette(list, height);
    const layout = FLATLAY_LAYOUTS[list.length] || FLATLAY_LAYOUTS[6];
    return (
      <div style={{ position: "relative", height, borderRadius: 18, background: "#FFFFFF", overflow: "hidden" }}>
        {list.map((item, idx) => {
          const [l, t, w, h, r] = layout[idx];
          return (
            <div
              key={item.id}
              style={isCutout(item)
                // Vêtement détouré : posé directement sur le fond blanc, avec une ombre qui suit sa forme.
                ? { position: "absolute", left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${h}%`, transform: `rotate(${r}deg)` }
                : { position: "absolute", left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${h}%`, transform: `rotate(${r}deg)`, borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 14px rgba(0,0,0,0.12)", background: item.hex }}
            >
              {item.photo && (
                <img
                  loading="lazy"
                  decoding="async"
                  src={item.photo}
                  alt={item.name}
                  style={isCutout(item)
                    ? { width: "100%", height: "100%", objectFit: "contain", display: "block", filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.18))" }
                    : { width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Date courte pour l'en-tête : "Jeudi 24 sept."
  function formatShortToday() {
    const str = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" });
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function formatTodayHeader() {
    const str = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  // Même principe, mais pour demain — utile pour le petit aperçu sur la page Aujourd'hui.
  function tomorrowKey() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  // Une date de l'agenda peut contenir PLUSIEURS tenues (ex: "Journée" et "Soir").
  // On normalise ici : si une date contient l'ancien format (juste une liste d'id),
  // on la transforme en une seule entrée sans nom, pour que le reste du code
  // n'ait jamais à se soucier de la différence entre ancien et nouveau format.
  function normalizeDayEntries(dayValue) {
    if (!Array.isArray(dayValue)) return [];
    if (dayValue.length === 0) return [];
    if (typeof dayValue[0] === "object") return dayValue; // déjà au nouveau format
    return [{ id: "legacy", label: "Tenue", itemIds: dayValue }]; // ancien format : conversion à la volée
  }

  // Ajoute une nouvelle tenue planifiée à une date (sans écraser celles déjà présentes ce jour-là).
  function planItemsOnDate(dateStr, itemIds, label, outfitId) {
    if (!dateStr || itemIds.length === 0) return;
    const newEntry = { id: Date.now(), label: label.trim() || "Tenue", itemIds, ...(outfitId ? { outfitId } : {}) };
    setAgenda((prev) => ({ ...prev, [dateStr]: [...normalizeDayEntries(prev[dateStr]), newEntry] }));
    showToast({ text: dateStr === todayKey() ? "Prévue pour aujourd'hui ✓" : dateStr === tomorrowKey() ? "Prévue pour demain ✓" : `Prévue le ${formatShortDate(dateStr)} ✓` });
    setPlanDate("");
    setPlanItemIds([]);
    setPlanLabel("");
  }

  // Ajoute en plus cette sélection à la collection de tenues réutilisables (onglet Tenues).
  // Si dateStr/entryId sont fournis, on relie aussi l'entrée d'agenda à cette nouvelle tenue
  // (pour que "Portée aujourd'hui" reste synchronisé, comme pour une tenue créée normalement).
  // Renvoie false si on attend une réponse sur un doublon (encadré affiché), true sinon.
  function saveAsReusableOutfit(itemIds, label, dateStr, entryId, force = false) {
    if (itemIds.length === 0) return true;
    const m = findSimilarOutfit(itemIds);
    if (m && m.exact) {
      // Déjà dans la collection : on relie simplement l'entrée d'agenda à cette tenue.
      if (dateStr && entryId) {
        setAgenda((prev) => ({ ...prev, [dateStr]: normalizeDayEntries(prev[dateStr]).map((e) => (e.id === entryId ? { ...e, outfitId: m.outfit.id } : e)) }));
      }
      showToast({ text: `Déjà dans tes tenues : « ${m.outfit.name} »` });
      setReusableDup(null);
      return true;
    }
    if (m && !force) { setReusableDup({ m, itemIds, label, dateStr, entryId }); return false; }
    setReusableDup(null);
    const newOutfitId = Date.now() + 1;
    // Une impro ("Mix 24 sept.") qui rejoint ta collection devient une vraie "Tenue N".
    const cleanLabel = (label || "").trim();
    const name = !cleanLabel || /^mix \d/i.test(cleanLabel) || ["tenue", "tenue du jour"].includes(cleanLabel.toLowerCase()) ? nextOutfitName() : cleanLabel;
    const newOutfit = { id: newOutfitId, name, itemIds, favorite: false, wornDates: [], weather: [], occasions: [] };
    setOutfits((prev) => [...prev, newOutfit]);

    if (dateStr && entryId) {
      setAgenda((prev) => ({
        ...prev,
        [dateStr]: normalizeDayEntries(prev[dateStr]).map((e) => (e.id === entryId ? { ...e, outfitId: newOutfitId } : e)),
      }));
    }
    showToast({ text: "Ajoutée à tes tenues ✓" });
    return true;
  }

  // Petit message en bas de l'écran, qui disparaît tout seul.
  function showToast(t) {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  // "Je le porte aujourd'hui" depuis la fiche d'un vêtement : on l'ajoute à la tenue du jour
  // (on la crée si rien n'est prévu) et on le compte comme porté. Un 2e toucher annule.
  function wearItemToday(item) {
    const today = todayKey();
    const todayStr = new Date().toDateString();
    const wornToday = (item.wornDates || []).some((d) => new Date(d).toDateString() === todayStr);
    if (wornToday) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, wornDates: (i.wornDates || []).filter((d) => new Date(d).toDateString() !== todayStr) } : i)));
      setAgenda((prev) => {
        const list = normalizeDayEntries(prev[today]);
        const next = list.map((e) => ({ ...e, itemIds: e.itemIds.filter((id) => id !== item.id) })).filter((e) => e.itemIds.length > 0 || e.wornPhoto);
        const copy = { ...prev };
        if (next.length) copy[today] = next; else delete copy[today];
        return copy;
      });
      showToast({ text: "Retiré de ta tenue du jour" });
      return;
    }
    const list = normalizeDayEntries(agenda[today]);
    let label;
    if (list.length === 0) {
      label = "Tenue du jour";
      setAgenda((prev) => ({ ...prev, [today]: [...normalizeDayEntries(prev[today]), { id: Date.now(), label, itemIds: [item.id] }] }));
    } else {
      const target = list[0];
      label = target.label;
      setAgenda((prev) => ({
        ...prev,
        [today]: normalizeDayEntries(prev[today]).map((e) => (e.id === target.id && !e.itemIds.includes(item.id) ? { ...e, itemIds: [...e.itemIds, item.id] } : e)),
      }));
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, wornDates: [...(i.wornDates || []), new Date().toISOString()] } : i)));
    const shownName = entryDisplayName(today, list.length ? list[0] : { label });
    showToast({ text: `Ajouté à « ${shownName} »`, sub: "Ta tenue d'aujourd'hui", action: "Voir", onAction: () => changeView("accueil") });
  }

  // Ouvre la création d'une tenue (depuis l'onglet Tenues ou le bouton "+").
  function openCreateOutfit() {
    setCreateOutfitStep("select");
    setOutfitTags(EMPTY_OUTFIT_TAGS);
    setOutfitName(nextOutfitName());
    setSelectedIds([]);
    setShowOutfitForm(true);
  }

  // ── SAUVEGARDE / RESTAURATION ──
  // Tout ce qui est rangé sur ce téléphone (vêtements, tenues, agenda…) dans un seul fichier.
  // Les photos sont déjà en ligne (Supabase) : le fichier contient seulement leurs liens.
  async function exportBackup() {
    const data = {
      app: "mon-armoire",
      version: 1,
      savedAt: new Date().toISOString(),
      userName,
      items,
      outfits,
      agenda,
      rediscoverHidden,
    };
    const stamp = new Date().toISOString().slice(0, 10);
    const fileName = `pli-sauvegarde-${stamp}.json`;
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    // Sur iPhone, le plus fiable est la feuille de partage ("Enregistrer dans Fichiers").
    try {
      const file = new File([blob], fileName, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Sauvegarde pli" });
        return;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return; // partage annulé
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // Recharge un fichier de sauvegarde (remplace les données de cet appareil, après confirmation).
  function importBackup(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); } catch { data = null; }
      if (!data || data.app !== "mon-armoire" || !Array.isArray(data.items)) {
        alert("Ce fichier n'est pas une sauvegarde pli.");
        return;
      }
      const when = data.savedAt ? new Date(data.savedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "?";
      const ok = window.confirm(
        `Restaurer la sauvegarde du ${when} ?\n\n${data.items.length} vêtements, ${(data.outfits || []).length} tenues.\n\nCe qui est actuellement sur cet appareil sera remplacé.`
      );
      if (!ok) return;
      setItems(data.items);
      setOutfits(data.outfits || []);
      setAgenda(data.agenda || {});
      if (data.rediscoverHidden) {
        setRediscoverHidden(data.rediscoverHidden);
        try { localStorage.setItem("mon-armoire-rediscover-hidden", JSON.stringify(data.rediscoverHidden)); } catch {}
      }
      if (data.userName) {
        localStorage.setItem("mon-armoire-username", data.userName);
        setUserName(data.userName);
      }
      alert("Sauvegarde restaurée ✓");
    };
    reader.readAsText(file);
  }

  // ── CARNET : photo de la tenue portée ──
  // Enregistre (ou remplace) la photo portée d'une entrée d'agenda.
  function setEntryWornPhoto(dateStr, entryId, url) {
    setAgenda((prev) => ({
      ...prev,
      [dateStr]: normalizeDayEntries(prev[dateStr]).map((e) => (e.id === entryId ? { ...e, wornPhoto: url } : e)),
    }));
  }

  // Retire la photo portée d'une entrée (la tenue prévue, elle, reste).
  function removeEntryWornPhoto(dateStr, entryId) {
    const entry = normalizeDayEntries(agenda[dateStr]).find((e) => e.id === entryId);
    if (!entry) return;
    if (entry.wornPhoto) deleteFromStorage(entry.wornPhoto);
    if (entry.itemIds.length === 0) removeAgendaEntry(dateStr, entryId); // entrée qui n'était qu'une photo
    else setEntryWornPhoto(dateStr, entryId, null);
  }

  // Photo choisie (appareil photo ou galerie) : on la réduit, on l'envoie sur Supabase,
  // puis on la range sur l'entrée d'agenda. Sans entrée précise (bouton appareil photo du Carnet),
  // on la met sur la première tenue du jour sans photo, ou on crée une entrée "photo seule".
  function handleWornPhoto(e, dateStr, entryId) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    let targetId = entryId;
    let createNew = false;
    if (targetId == null) {
      const dayList = normalizeDayEntries(agenda[dateStr]);
      const free = dayList.find((x) => !x.wornPhoto);
      if (free) targetId = free.id;
      else { targetId = Date.now(); createNew = true; }
    }
    const reader = new FileReader();
    reader.onload = async () => {
      setUploadingWornFor(createNew ? "new" : targetId);
      try {
        const resized = await resizeImageDataUrl(reader.result, 1200);
        const url = await uploadPhotoToStorage(resized, "porte");
        if (createNew) {
          setAgenda((prev) => ({ ...prev, [dateStr]: [...normalizeDayEntries(prev[dateStr]), { id: targetId, label: "Tenue", itemIds: [], wornPhoto: url }] }));
        } else {
          const old = normalizeDayEntries(agenda[dateStr]).find((x) => x.id === targetId);
          if (old && old.wornPhoto) deleteFromStorage(old.wornPhoto);
          setEntryWornPhoto(dateStr, targetId, url);
        }
        showToast({ text: "Photo ajoutée au Carnet ✓", action: "Voir", onAction: () => { changeView("agenda"); setAgendaTab("carnet"); } });
      } catch (err) {
        alert("La photo n'a pas pu être envoyée. Vérifie ta connexion et réessaie.");
      } finally {
        setUploadingWornFor(null);
      }
    };
    reader.onerror = () => alert("Cette photo n'a pas pu être ouverte. Essaie avec une autre photo.");
    reader.readAsDataURL(file);
  }

  // Bloc "photo portée" d'une tenue, pour les popups : grande photo avec "Changer",
  // ou zone pointillée "Ajouter la photo portée" (seulement pour aujourd'hui et les jours passés).
  // Ouvre une photo dans la visionneuse du Carnet (onglet Agenda → Carnet).
  function openInCarnet(entryId) {
    setDayViewDate(null);
    setOpenEntryId(null);
    if (view !== "agenda") changeView("agenda");
    setAgendaTab("carnet");
    setTimeout(() => setCarnetViewId(entryId), 0);
  }

  // Dans les popups d'une tenue : un lien discret vers la photo du Carnet,
  // ou un petit bouton pour en ajouter une (aujourd'hui et jours passés seulement).
  function renderWornPhotoBlock(entry) {
    const busy = uploadingWornFor === entry.entryId;
    if (entry.wornPhoto) {
      return (
        <button type="button" onClick={() => openInCarnet(entry.entryId)} className="w-full flex items-center gap-3 p-2.5 mb-3 rounded-2xl text-left" style={{ background: COLORS.haze }}>
          <span className="overflow-hidden flex-shrink-0" style={{ width: 52, height: 52, borderRadius: 12 }}>
            <img src={entry.wornPhoto} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm" style={{ fontWeight: 700 }}>Photo portée</span>
            <span className="block text-xs" style={{ color: COLORS.muted }}>Voir dans le Carnet</span>
          </span>
          <ArrowLeft size={16} color={COLORS.muted} style={{ transform: "rotate(180deg)" }} />
        </button>
      );
    }
    if (entry.dateStr > todayKey()) return null;
    return (
      <label className="inline-flex items-center gap-1.5 mb-3 text-xs cursor-pointer" style={{ color: COLORS.rose, fontWeight: 700 }}>
        <Camera size={14} /> {busy ? "Envoi en cours…" : "Ajouter la photo portée au Carnet"}
        <input type="file" accept="image/*" onChange={(ev) => handleWornPhoto(ev, entry.dateStr, entry.entryId)} className="hidden" />
      </label>
    );
  }

  // Retire une tenue précise d'une date (et pas toutes les tenues de ce jour).
  function removeAgendaEntry(dateStr, entryId) {
    const old = normalizeDayEntries(agenda[dateStr]).find((e) => e.id === entryId);
    if (old && old.wornPhoto) deleteFromStorage(old.wornPhoto);
    setAgenda((prev) => {
      const remaining = normalizeDayEntries(prev[dateStr]).filter((e) => e.id !== entryId);
      const next = { ...prev };
      if (remaining.length === 0) delete next[dateStr];
      else next[dateStr] = remaining;
      return next;
    });
  }

  // Formate "2026-08-29" en "29 août 2026", plus agréable à lire.
  function formatAgendaDate(dateStr) {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  }

  // Construit une clé "AAAA-MM-JJ" à partir d'une année, d'un mois (0-11) et d'un jour.
  function toDateKey(year, monthIndex, day) {
    const mm = String(monthIndex + 1).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }

  // Décale une date (au format clé) de "delta" jours — utilisé pour glisser d'un jour à l'autre.
  function shiftDateKey(dateStr, delta) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + delta);
    return toDateKey(d.getFullYear(), d.getMonth(), d.getDate());
  }

  // Construit la grille du mois affiché : des cases vides pour caler le premier jour
  // sur le bon jour de la semaine (semaine commençant le lundi), puis les jours du mois.
  function buildCalendarCells(monthDate) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startOffset = (firstDay.getDay() + 6) % 7; // getDay() : dimanche=0 → on veut lundi=0
    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }

  // Nom affiché d'une tenue prévue :
  // - tenue enregistrée → son nom actuel (Tenue 3, ou le nom que tu lui as donné) ;
  // - tenue improvisée → le nom que tu as tapé, sinon "Mix 24 sept.".
  function entryDisplayName(dateStr, entry) {
    const saved = entry.outfitId && outfits.find((o) => o.id === entry.outfitId);
    if (saved) return saved.name;
    const generic = !entry.label || ["tenue", "tenue du jour"].includes(entry.label.trim().toLowerCase());
    if (!generic) return entry.label;
    const [y, m, d] = dateStr.split("-").map(Number);
    return `Mix ${new Date(y, m - 1, d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;
  }

  // Toutes les tenues planifiées, toutes dates confondues, une ligne par tenue
  // (une même date peut donc apparaître plusieurs fois si plusieurs tenues y sont prévues).
  const agendaEntries = Object.entries(agenda)
    .flatMap(([dateStr, dayValue]) =>
      normalizeDayEntries(dayValue).map((entry) => ({
        dateStr,
        entryId: entry.id,
        label: entryDisplayName(dateStr, entry),
        outfitId: entry.outfitId, // présent si cette entrée a été créée depuis une tenue enregistrée
        wornPhoto: entry.wornPhoto || null, // photo de la tenue portée (Carnet)
        planItems: entry.itemIds.map((id) => items.find((i) => i.id === id)).filter(Boolean), // au cas où un vêtement aurait été supprimé depuis
      }))
    )
    .filter((entry) => entry.planItems.length > 0 || entry.wornPhoto) // une photo portée seule suffit
    .sort((a, b) => a.dateStr.localeCompare(b.dateStr) || String(a.entryId).localeCompare(String(b.entryId)));

  // Tenues planifiées regroupées par mois, pour les rangées de l'Agenda :
  // le mois en cours d'abord, puis les mois à venir, puis les mois passés (du plus récent au plus ancien).
  const agendaMonthGroups = (() => {
    const currentMonth = todayKey().slice(0, 7);
    const byMonth = {};
    agendaEntries.forEach((e) => {
      const k = e.dateStr.slice(0, 7);
      (byMonth[k] = byMonth[k] || []).push(e);
    });
    const keys = Object.keys(byMonth);
    const future = keys.filter((k) => k > currentMonth).sort();
    const past = keys.filter((k) => k < currentMonth).sort().reverse();
    const ordered = [...(byMonth[currentMonth] ? [currentMonth] : []), ...future, ...past];
    return ordered.map((k) => ({ key: k, entries: byMonth[k] }));
  })();

  function isMonthOpen(monthKey) {
    return agendaOpenMonths ? agendaOpenMonths.includes(monthKey) : monthKey === todayKey().slice(0, 7);
  }
  function toggleMonth(monthKey) {
    setAgendaOpenMonths((prev) => {
      const current = prev || [todayKey().slice(0, 7)];
      return current.includes(monthKey) ? current.filter((k) => k !== monthKey) : [...current, monthKey];
    });
  }

  // Dans la popup d'un jour : aller à la tenue précédente / suivante (en sautant les jours vides).
  const plannedDates = [...new Set(agendaEntries.map((e) => e.dateStr))].sort();
  function prevPlannedDate(dateStr) {
    const before = plannedDates.filter((d) => d < dateStr);
    return before.length ? before[before.length - 1] : null;
  }
  function nextPlannedDate(dateStr) {
    return plannedDates.find((d) => d > dateStr) || null;
  }

  // "Septembre 2026"
  function formatMonthLabel(monthKey) {
    const [y, m] = monthKey.split("-").map(Number);
    const str = new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // Date courte sous chaque vignette de l'Agenda : "Aujourd'hui", "Demain" ou "jeu. 24".
  function formatShortDate(dateStr) {
    if (dateStr === todayKey()) return "Aujourd'hui";
    if (dateStr === tomorrowKey()) return "Demain";
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
  }
  const todayEntries = agendaEntries.filter((e) => e.dateStr === todayKey());
  const tomorrowEntries = agendaEntries.filter((e) => e.dateStr === tomorrowKey());

  // Vrai si tous les vêtements d'une liste ont déjà une date de port correspondant à aujourd'hui.
  function isPlanValidatedToday(planItems) {
    const todayStr = new Date().toDateString();
    return planItems.every((item) => (item.wornDates || []).some((d) => new Date(d).toDateString() === todayStr));
  }

  // Valide une tenue prévue : ajoute la date du jour à l'historique de chaque vêtement concerné,
  // et si cette entrée d'agenda est liée à une tenue enregistrée (outfitId), on la met à jour aussi
  // — pour que le bouton "Portée aujourd'hui" dans Tenues reste synchronisé.
  function validateTodayPlan(entry) {
    const todayISO = new Date().toISOString();
    const ids = entry.planItems.map((i) => i.id);
    setItems((prev) => prev.map((i) => (ids.includes(i.id) ? { ...i, wornDates: [...(i.wornDates || []), todayISO] } : i)));
    if (entry.outfitId) {
      setOutfits((prev) => prev.map((o) => (o.id === entry.outfitId ? { ...o, wornDates: [...(o.wornDates || []), todayISO] } : o)));
    }
    showToast({ text: "Portée aujourd'hui" });
  }

  // L'inverse : on retire la date du jour des pièces de cette tenue (et de la tenue enregistrée liée).
  function unvalidateTodayPlan(entry) {
    const todayStr = new Date().toDateString();
    const notToday = (d) => new Date(d).toDateString() !== todayStr;
    const ids = entry.planItems.map((i) => i.id);
    setItems((prev) => prev.map((i) => (ids.includes(i.id) ? { ...i, wornDates: (i.wornDates || []).filter(notToday) } : i)));
    if (entry.outfitId) {
      setOutfits((prev) => prev.map((o) => (o.id === entry.outfitId ? { ...o, wornDates: (o.wornDates || []).filter(notToday) } : o)));
    }
    showToast({ text: "Plus comptée comme portée aujourd'hui" });
  }

  // Le « je la porte » a deux états bien distincts :
  // pas encore fait → un vrai bouton corail ; fait → une bande rosée (pas un bouton) avec un petit « Annuler ».
  function renderWearState({ done, onDo, onUndo, fem = true, height = 50, className = "" }) {
    if (done) {
      return (
        <div className={`w-full flex items-center gap-2.5 rounded-full pl-2 pr-1 ${className}`} style={{ height, background: "#FDE8E5" }}>
          <span className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: height - 16, height: height - 16, background: COLORS.rose }}>
            <Check size={16} color="#FFFFFF" strokeWidth={3} />
          </span>
          <span className="flex-1 min-w-0 truncate text-sm" style={{ fontWeight: 700, color: COLORS.ink }}>{fem ? "Portée" : "Porté"} aujourd'hui</span>
          {onUndo && (
            <button type="button" onClick={onUndo} className="h-full px-3 text-xs flex-shrink-0" style={{ color: COLORS.muted, fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3 }}>
              Annuler
            </button>
          )}
        </div>
      );
    }
    return (
      <button type="button" onClick={onDo} className={`w-full rounded-full flex items-center justify-center text-sm ${className}`} style={{ height, fontWeight: 700, background: COLORS.rose, color: "#FFFFFF", boxShadow: "0 6px 16px rgba(255,75,51,0.3)" }}>
        Je {fem ? "la" : "le"} porte aujourd'hui
      </button>
    );
  }

  // Contenu d'une tenue prévue, identique dans la popup de l'accueil et dans celle de l'Agenda.
  function renderEntryBody(entry, { readOnly = false, onLeave = () => {} } = {}) {
    const saved = entry.outfitId && outfits.some((o) => o.id === entry.outfitId);
    return (
      <div key={entry.entryId}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm truncate" style={{ fontWeight: 600 }}>{entry.label}</p>
            {entry.planItems.length > 0 && renderPaletteDots([...new Set(entry.planItems.flatMap(itemColors).map((h) => h.toLowerCase()))].slice(0, 5), 12)}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Dans tes tenues enregistrées ? Rosé = oui (toucher pour l'ouvrir) ; gris = non (toucher pour l'ajouter) */}
            {entry.planItems.length > 0 && (
              <button
                type="button"
                onClick={() => (saved ? setDetailOutfitId(entry.outfitId) : saveAsReusableOutfit(entry.planItems.map((i) => i.id), entry.label, entry.dateStr, entry.entryId))}
                aria-label={saved ? "Dans tes tenues : voir la tenue" : "Pas encore dans tes tenues : l'ajouter"}
                title={saved ? "Dans tes tenues" : "Ajouter à tes tenues"}
                className="h-7 px-2 rounded-full flex items-center justify-center gap-1"
                style={{ background: saved ? "#FDE8E5" : COLORS.haze }}
              >
                <Layers size={13} color={saved ? COLORS.rose : COLORS.muted} />
                {saved ? <Check size={11} color={COLORS.rose} strokeWidth={3} /> : <Plus size={11} color={COLORS.muted} strokeWidth={3} />}
              </button>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={() => askConfirm("Supprimer cette tenue prévue ?", () => { removeAgendaEntry(entry.dateStr, entry.entryId); onLeave(); })}
                aria-label="Supprimer cette tenue prévue"
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: COLORS.haze }}
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>
        {reusableDup && reusableDup.entryId === entry.entryId && renderOutfitDupPanel(reusableDup.m, {
          onView: () => { setReusableDup(null); setDetailOutfitId(reusableDup.m.outfit.id); },
          onForce: () => saveAsReusableOutfit(reusableDup.itemIds, reusableDup.label, reusableDup.dateStr, reusableDup.entryId, true),
          forceLabel: "L'ajouter quand même",
        })}
        {renderPieceThumbs(entry.planItems, 3)}
        {!readOnly && (
          <button type="button" onClick={() => setEntryPicker({ dateStr: entry.dateStr, entryId: entry.entryId })} className="flex items-center gap-1.5 text-xs mt-2.5" style={{ color: COLORS.rose, fontWeight: 700 }}>
            <Plus size={13} /> Ajouter ou retirer une pièce
          </button>
        )}
        {entry.dateStr === todayKey() && entry.planItems.length > 0 && renderWearState({
          done: isPlanValidatedToday(entry.planItems),
          onDo: () => validateTodayPlan(entry),
          onUndo: () => unvalidateTodayPlan(entry),
          className: "mt-4",
        })}
        <div className="mt-3">{renderWornPhotoBlock(entry)}</div>
      </div>
    );
  }

  // Retire un vêtement d'une tenue précise (identifiée par sa date + son id d'entrée).
  function removeItemFromEntry(dateStr, entryId, itemId) {
    setAgenda((prev) => ({
      ...prev,
      [dateStr]: normalizeDayEntries(prev[dateStr]).map((e) =>
        e.id === entryId ? { ...e, itemIds: e.itemIds.filter((id) => id !== itemId) } : e
      ),
    }));
  }

  // Ajoute un vêtement à une tenue précise (utilisé pour ajouter ou échanger depuis la popup).
  function addItemToEntry(dateStr, entryId, itemId) {
    setAgenda((prev) => ({
      ...prev,
      [dateStr]: normalizeDayEntries(prev[dateStr]).map((e) =>
        e.id === entryId ? { ...e, itemIds: [...e.itemIds, itemId] } : e
      ),
    }));
  }

  if (!loaded || !splashDone) {
    // Écran d'ouverture : fond blanc, tout en corail, "pli" en grand qui se replie à la taille de l'icône,
    // puis le contour et la vague se dessinent ensemble. Joué une fois, ~1,9 s.
    return (
      <div className="splash-screen" style={{ background: "#FFFFFF", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Karla:wght@400;500;600;700&family=Merriweather:ital,wght@0,400;0,700;1,400;1,700&display=swap');
          @keyframes splashTxt { 0% { opacity: 0; transform: scale(2.6); } 15%, 40% { opacity: 1; transform: scale(2.6); } 70%, 100% { opacity: 1; transform: scale(1); } }
          @keyframes splashDraw { 0%, 60% { stroke-dashoffset: 101; } 90%, 100% { stroke-dashoffset: 0; } }
          @keyframes splashOut { 0%, 85% { opacity: 1; } 100% { opacity: 0; } }
          .splash-screen { animation: splashOut 1.9s ease-in forwards; }
          .splash-txt { animation: splashTxt 1.5s cubic-bezier(.7,0,.3,1) forwards; transform-box: fill-box; transform-origin: center; }
          .splash-draw { stroke-dasharray: 101 101; stroke-dashoffset: 101; animation: splashDraw 1.5s ease-in-out forwards; }
        `}</style>
        <svg viewBox="0 0 100 100" width="140" height="140" style={{ overflow: "visible" }} aria-label="pli">
          <rect className="splash-draw" pathLength="100" x="1.5" y="1.5" width="97" height="97" rx="22" fill="none" stroke="#FF4B33" strokeWidth="3" />
          <defs><clipPath id="splash-clip"><rect width="100" height="100" rx="22.5" /></clipPath></defs>
          <g clipPath="url(#splash-clip)">
            <path className="splash-draw" pathLength="100" transform="translate(100,0) scale(-1,1)" d="M-4 46 Q8 52 10 62 T26 74 T40 90 T54 104" fill="none" stroke="#FF4B33" strokeWidth="5" strokeLinecap="round" />
          </g>
          <text className="splash-txt" x="44" y="52" textAnchor="middle" fill="#FF4B33" style={{ fontFamily: "'Merriweather', serif", fontWeight: 700, fontStyle: "italic", fontSize: 40 }}>pli</text>
        </svg>
      </div>
    );
  }

  // Écran de bienvenue, affiché une seule fois : tant qu'aucun prénom n'est enregistré
  // sur cet appareil, on ne montre pas encore le contenu de l'appli.
  if (!userName) {
    return (
      <div style={{ background: "#FFFFFF", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Karla:wght@400;500;600;700&family=Merriweather:ital,wght@0,400;0,700;1,400;1,700&display=swap'); * { font-family: 'Karla', sans-serif; }`}</style>
        <div style={{ width: "100%", maxWidth: 320, textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
            <PliLogo size={64} />
          </div>
          <p style={{ fontSize: 22, fontWeight: 700, color: "#111111", marginBottom: 8, fontFamily: "'Merriweather', serif" }}>Bienvenue dans <i>pli</i></p>
          <p style={{ fontSize: 14, color: "#999999", marginBottom: 20 }}>Comment tu t'appelles ?</p>
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveUserName()}
            placeholder="Ton prénom"
            className="w-full px-4 py-3 rounded-full text-sm text-center mb-3"
            style={{ border: "1px solid #EBEBEB", outline: "none" }}
            autoFocus
          />
          <button
            onClick={saveUserName}
            disabled={!nameInput.trim()}
            className="w-full px-4 py-3 rounded-full text-sm text-white"
            style={{ background: "#FF4B33", opacity: nameInput.trim() ? 1 : 0.4 }}
          >
            Commencer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ background: COLORS.ivory, minHeight: "100vh", color: COLORS.ink }}
      onTouchStart={handleEdgeTouchStart}
      onTouchEnd={handleEdgeTouchEnd}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Karla:wght@400;500;600;700&family=Merriweather:ital,wght@0,400;0,700;1,400;1,700&display=swap');
        * { font-family: 'Karla', sans-serif; box-sizing: border-box; }
        .display { font-family: 'Merriweather', serif; letter-spacing: 0; }
        @keyframes appIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes slideFromRight {
          from { opacity: 0; transform: translateX(24px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideFromLeft {
          from { opacity: 0; transform: translateX(-24px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .app-content { animation: appIn 0.4s ease-out; }
        .slide-right { animation: slideFromRight 0.28s ease-out; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fanOut { from { opacity: 0; transform: translate(var(--fx), var(--fy)) scale(0.3); } to { opacity: 1; transform: none; } }
        @keyframes navLabelIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
        .nav-label { animation: navLabelIn 0.2s ease-out; }
        .slide-left  { animation: slideFromLeft 0.28s ease-out; }
        @keyframes wizardSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .wizard-spin { animation: wizardSpin 0.9s linear infinite; display: inline-flex; }
        .no-scrollbar { scrollbar-width: none; -webkit-overflow-scrolling: touch; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>

      <div
        className="max-w-3xl mx-auto px-5 pt-10 app-content"
        style={{ paddingBottom: 120 }}
      >
        {/* ── EN-TÊTE — uniquement sur la page Aujourd'hui ── */}
        {view === "accueil" && (
          (() => {
            const palette = todayPalette();
            const weatherInfo = weatherStatus === "granted" && weather ? getWeatherInfo(weather.code) : null;
            const WeatherIcon = weatherInfo ? weatherInfo.Icon : Sun;
            return (
              <div className="mb-7">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <WeatherIcon size={15} color={COLORS.rose} />
                    <p className="text-sm truncate" style={{ color: "#666666" }}>
                      {formatShortToday()}
                    </p>
                    {(syncStatus === "error" || syncStatus === "offline") && (
                      <CloudOff size={14} color={COLORS.rose} aria-label="Pas encore enregistré en ligne" />
                    )}
                  </div>
                  {palette.length > 0 && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs" style={{ color: COLORS.muted }}>Palette du jour</span>
                      <span className="flex" style={{ paddingLeft: 6 }}>
                        {palette.map((hex) => (
                          <span key={hex} style={{ width: 22, height: 22, borderRadius: 11, background: hex, border: "1px solid rgba(0,0,0,0.1)", marginLeft: -6, boxShadow: "0 0 0 2px #FFFFFF" }} />
                        ))}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3" style={{ marginTop: 8 }}>
                  <h1 className="display" style={{ fontStyle: "italic", fontWeight: 700, fontSize: 32, lineHeight: 1.1 }}>{getGreeting(userName)}</h1>
                  <button type="button" onClick={() => setShowSettings(true)} aria-label="Paramètres" className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: COLORS.haze }}>
                    <Settings size={18} />
                  </button>
                </div>
                {/* Fin trait aux couleurs du jour (corail si rien n'est prévu) */}
                <div
                  style={{
                    height: 4,
                    borderRadius: 2,
                    marginTop: 12,
                    background: palette.length > 1 ? `linear-gradient(90deg, ${palette.join(", ")})` : palette[0] || COLORS.rose,
                  }}
                />
                {(weatherStatus === "denied" || weatherStatus === "error") && (
                  <button onClick={requestWeather} className="text-xs mt-2" style={{ color: COLORS.rose }}>
                    Activer la météo
                  </button>
                )}
              </div>
            );
          })()
        )}

        {/* ══════════════════ VUE ACCUEIL ══════════════════ */}
        {view === "accueil" && (
          <div key={view} className={slideDir === "right" ? "slide-right" : "slide-left"}>
            {/* ── Grande météo : température, matin / midi / soir, et un conseil ── */}
            {weatherStatus === "granted" && weather && (() => {
              const info = getWeatherInfo(weather.dailyCode != null ? weather.dailyCode : weather.code);
              const BigIcon = getWeatherInfo(weather.code).Icon;
              const hours = weather.hours || {};
              const slots = [["Matin", hours.matin], ["Midi", hours.midi], ["Soir", hours.soir]].filter(([, h]) => h);
              return (
                <div className="mb-7 flex flex-col gap-3.5">
                  <div className="flex items-end justify-between">
                    <div className="flex items-start gap-2.5">
                      <span className="display" style={{ fontWeight: 700, fontSize: 64, lineHeight: 0.9, letterSpacing: "-0.02em" }}>{weather.temp}°</span>
                      <div style={{ paddingTop: 6 }}>
                        <p style={{ fontSize: 15, fontWeight: 600 }}>{info.label || "Aujourd'hui"}</p>
                        <p className="text-sm" style={{ color: COLORS.muted, marginTop: 2 }}>
                          {weather.min}° / {weather.max}°{weatherCity ? ` · ${weatherCity}` : ""}
                        </p>
                      </div>
                    </div>
                    <BigIcon size={40} color={COLORS.rose} strokeWidth={1.6} />
                  </div>
                  {slots.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {slots.map(([label, h]) => {
                        const SlotIcon = getWeatherInfo(h.code).Icon;
                        return (
                          <div key={label} className="flex items-center justify-between" style={{ padding: "10px 12px", borderRadius: 14, border: `1px solid ${COLORS.line}` }}>
                            <div>
                              <p className="text-xs" style={{ color: COLORS.muted }}>{label}</p>
                              <p style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{h.temp}°</p>
                            </div>
                            <SlotIcon size={20} color={COLORS.ink} strokeWidth={1.6} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex items-start gap-2.5" style={{ padding: "12px 14px", borderRadius: 14, background: "#FDE8E5" }}>
                    <Sparkles size={16} color={COLORS.rose} style={{ flexShrink: 0, marginTop: 2 }} />
                    <p className="text-sm" style={{ lineHeight: 1.4 }}>{weatherAdvice(weather)}</p>
                  </div>
                </div>
              );
            })()}

            {/* ── Pour aujourd'hui : la tenue en "flat lay", en carrousel s'il y en a plusieurs ── */}
            <div className="p-4 mb-7" style={{ background: COLORS.haze, borderRadius: 24 }}>
              <div className="flex items-center justify-between mb-3">
                <p className="display" style={{ fontWeight: 700, fontSize: 16 }}>Pour aujourd'hui</p>
                <button
                  type="button"
                  onClick={() => openQuickPlan(todayKey())}
                  aria-label={todayEntries.length > 0 ? "Ajouter une autre tenue pour aujourd'hui" : "Planifier une tenue pour aujourd'hui"}
                  className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: COLORS.ivory, color: COLORS.ink }}
                >
                  <Plus size={14} />
                </button>
              </div>

              {todayEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center gap-3" style={{ height: 200, borderRadius: 18, background: "#FFFFFF", padding: 20 }}>
                  <p className="text-sm" style={{ color: COLORS.muted }}>Rien de prévu pour l'instant</p>
                  <div className="flex gap-2">
                    {items.length > 0 && (
                      <button type="button" onClick={() => openWizard(todayKey())} className="px-4 h-9 rounded-full text-sm flex items-center gap-1.5" style={{ background: COLORS.ink, color: "#FFFFFF", fontWeight: 600 }}>
                        <Sparkles size={14} /> Générer
                      </button>
                    )}
                    <button type="button" onClick={() => openQuickPlan(todayKey())} className="px-4 h-9 rounded-full text-sm" style={{ background: COLORS.haze, color: COLORS.ink, fontWeight: 600 }}>
                      Choisir
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    data-no-swipe
                    className="no-scrollbar flex overflow-x-auto"
                    style={{ scrollSnapType: "x mandatory", gap: 12 }}
                    onScroll={(e) => {
                      const el = e.currentTarget;
                      const idx = Math.round(el.scrollLeft / (el.clientWidth + 12));
                      if (idx !== todaySlide) setTodaySlide(idx);
                    }}
                  >
                    {todayEntries.map((entry) => {
                      const validated = isPlanValidatedToday(entry.planItems);
                      return (
                        <div key={entry.entryId} style={{ flex: "0 0 100%", scrollSnapAlign: "start", minWidth: 0 }}>
                          <div className="relative cursor-pointer" onClick={() => setOpenEntryId(entry.entryId)}>
                            {entry.planItems.length === 0 && entry.wornPhoto ? (
                              <img src={entry.wornPhoto} alt={`Tenue portée — ${entry.label}`} style={{ width: "100%", height: 330, objectFit: "cover", display: "block", borderRadius: 18 }} />
                            ) : renderFlatLay(entry.planItems, 330)}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); askConfirm("Supprimer cette tenue prévue ?", () => removeAgendaEntry(entry.dateStr, entry.entryId)); }}
                              aria-label="Supprimer cette tenue prévue"
                              className="absolute w-7 h-7 rounded-full flex items-center justify-center"
                              style={{ top: 10, right: 10, background: "rgba(255,255,255,0.9)", zIndex: 2 }}
                            >
                              <X size={13} />
                            </button>
                          </div>
                          <div className="flex items-center justify-between gap-2 mt-3">
                            <p className="truncate" style={{ fontSize: 15, fontWeight: 600 }}>{entry.label}</p>
                            {renderPaletteDots([...new Set(entry.planItems.flatMap(itemColors).map((h) => h.toLowerCase()))].slice(0, 5), 14, COLORS.haze)}
                          </div>
                          {renderWearState({ done: validated, onDo: () => validateTodayPlan(entry), onUndo: () => unvalidateTodayPlan(entry), height: 46, className: "mt-3" })}
                          {validated && !entry.wornPhoto && (
                            <label className="flex items-center justify-center gap-1.5 text-sm mt-2.5 cursor-pointer" style={{ color: COLORS.rose, fontWeight: 600 }}>
                              <Camera size={14} /> {uploadingWornFor === entry.entryId ? "Envoi en cours…" : "Ajoute la photo pour ton Carnet"}
                              <input type="file" accept="image/*" onChange={(ev) => handleWornPhoto(ev, entry.dateStr, entry.entryId)} className="hidden" />
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {todayEntries.length > 1 && (
                    <div className="flex justify-center gap-1.5 mt-3">
                      {todayEntries.map((entry, i) => (
                        <span key={entry.entryId} style={{ width: i === Math.min(todaySlide, todayEntries.length - 1) ? 16 : 6, height: 6, borderRadius: 3, background: i === Math.min(todaySlide, todayEntries.length - 1) ? COLORS.ink : "#D5D3CF", transition: "width 0.2s" }} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Redécouvre : une pièce oubliée à ressortir ── */}
            {rediscoverItem && (
              <div className="flex gap-3.5 items-center mb-7" style={{ padding: 14, borderRadius: 20, border: `1px solid ${COLORS.line}` }}>
                <button
                  type="button"
                  onClick={() => { changeView("dressing"); setDetailItemId(rediscoverItem.id); }}
                  aria-label={`Voir ${rediscoverItem.name}`}
                  className="flex-shrink-0 overflow-hidden"
                  style={{ width: 88, height: 88, borderRadius: 16, background: rediscoverItem.photo ? COLORS.haze : rediscoverItem.hex }}
                >
                  {rediscoverItem.photo && (
                    <img loading="lazy" decoding="async" src={thumbOf(rediscoverItem)} alt={rediscoverItem.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-xs uppercase" style={{ fontWeight: 600, color: COLORS.rose, letterSpacing: "0.06em" }}>Redécouvre</p>
                  <p className="display truncate" style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>{rediscoverItem.name}</p>
                  <p className="text-sm" style={{ color: COLORS.muted, marginTop: 2 }}>{rediscoverSubtitle(rediscoverItem)}</p>
                  <button
                    type="button"
                    onClick={() => openWizard(todayKey(), rediscoverItem.id)}
                    className="mt-2.5 rounded-full flex items-center gap-1.5 text-sm"
                    style={{ height: 34, padding: "0 14px", border: `1px solid ${COLORS.rose}`, color: COLORS.rose, fontWeight: 600, whiteSpace: "nowrap" }}
                  >
                    <Sparkles size={14} /> Créer une tenue
                  </button>
                  <div className="flex gap-4 mt-2">
                    {rediscoverPool.length > 1 && (
                      <button type="button" onClick={() => setRediscoverSkip((n) => n + 1)} className="text-xs" style={{ color: COLORS.muted, fontWeight: 600 }}>
                        Autre
                      </button>
                    )}
                    <button type="button" onClick={() => hideRediscover(rediscoverItem.id)} className="text-xs" style={{ color: COLORS.muted, fontWeight: 600 }}>
                      Pas celle-là
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Ta semaine : du lundi au dimanche ── */}
            {(() => {
              const days = weekDays();
              const wornCount = days.filter((d) => d.worn.length > 0).length;
              return (
                <div className="mb-7">
                  <div className="flex items-baseline justify-between mb-2.5">
                    <p className="display" style={{ fontWeight: 700, fontSize: 16 }}>Ta semaine</p>
                    <p className="text-sm" style={{ color: COLORS.muted }}>
                      {wornCount === 0 ? "Rien de porté encore" : `${wornCount} tenue${wornCount > 1 ? "s" : ""} portée${wornCount > 1 ? "s" : ""}`}
                    </p>
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {days.map((d) => (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => {
                          if (d.planned.length) setOpenEntryId(d.planned[0].entryId);
                          else if (d.key >= todayKey()) openQuickPlan(d.key);
                        }}
                        className="flex flex-col items-center gap-1.5"
                      >
                        <div style={{ borderRadius: 10, boxShadow: d.isToday ? `0 0 0 2px ${COLORS.rose}` : "none" }}>
                          {d.shown.length === 0 && d.planned.some((e) => e.wornPhoto)
                            ? <img src={d.planned.find((e) => e.wornPhoto).wornPhoto} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover", display: "block" }} />
                            : d.shown.length > 0
                            ? renderMiniMosaic(d.shown, 40, d.worn.length === 0)
                            : <div style={{ width: 40, height: 40, borderRadius: 10, border: "1.5px dashed #E2E0DC" }} />}
                        </div>
                        <span className="text-xs" style={{ color: d.isToday ? COLORS.rose : COLORS.muted, fontWeight: d.isToday ? 700 : 400 }}>{d.letter}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* ── Chiffres parlants ── */}
            {(() => {
              const monthKey = todayKey().slice(0, 7);
              const wornThisMonth = items.filter((i) => itemWornDays(i).some((d) => d.slice(0, 7) === monthKey)).length;
              const neverWorn = items.filter((i) => itemWornDays(i).length === 0).length;
              const stats = [
                { sort: "mois", n: wornThisMonth, label: `pièce${wornThisMonth > 1 ? "s" : ""} portée${wornThisMonth > 1 ? "s" : ""} ce mois-ci` },
                { sort: "jamais", n: neverWorn, label: `jamais portée${neverWorn > 1 ? "s" : ""}` },
                { sort: "favoris", n: favoriteItemsCount, label: `favori${favoriteItemsCount > 1 ? "s" : ""}`, accent: true },
              ];
              return (
                <div className="grid grid-cols-3 gap-2 mb-7">
                  {stats.map((st) => (
                    <button
                      key={st.sort}
                      type="button"
                      onClick={() => { changeView("dressing"); setCategoryView(ALL_ITEMS_VIEW); setCategorySort(st.sort); }}
                      className="text-left"
                      style={{ padding: "14px 12px", borderRadius: 16, background: COLORS.haze }}
                    >
                      <p className="display" style={{ fontWeight: 700, fontSize: 26, lineHeight: 1, color: st.accent ? COLORS.rose : COLORS.ink }}>{st.n}</p>
                      <p className="text-xs" style={{ marginTop: 6, lineHeight: 1.3, color: "#777777" }}>{st.label}</p>
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* ── Tes couleurs les plus portées (palette pondérée par le nombre de fois porté) ── */}
            {(() => {
              const stats = {};
              items.forEach((i) => {
                const n = itemWornDays(i).length;
                if (!n) return;
                itemColors(i).forEach((hex, k) => {
                  const name = hexToColorName(hex);
                  const w = k === 0 ? n : n * 0.5; // les couleurs de motif comptent pour moitié
                  const c = stats[name] || (stats[name] = { name, w: 0, hexW: {} });
                  c.w += w;
                  c.hexW[hex] = (c.hexW[hex] || 0) + w;
                });
              });
              const top = Object.values(stats).sort((x, y) => y.w - x.w).slice(0, 5);
              if (top.length < 2) return null;
              const total = top.reduce((t, c) => t + c.w, 0);
              top.forEach((c) => { c.hex = Object.entries(c.hexW).sort((x, y) => y[1] - x[1])[0][0]; c.pct = Math.round((c.w / total) * 100); });
              return (
                <div className="mb-7">
                  <div className="flex items-baseline justify-between mb-2.5">
                    <p className="display" style={{ fontWeight: 700, fontSize: 16 }}>Tes couleurs</p>
                    <p className="text-sm" style={{ color: COLORS.muted }}>les plus portées</p>
                  </div>
                  <div className="flex overflow-hidden mb-3" style={{ height: 14, borderRadius: 7 }}>
                    {top.map((c) => (
                      <span key={c.name} style={{ width: `${c.pct}%`, background: c.hex, borderRight: "2px solid #FFFFFF" }} />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {top.map((c) => (
                      <span key={c.name} className="inline-flex items-center gap-1.5 text-xs">
                        <span style={{ width: 10, height: 10, borderRadius: 5, background: c.hex, border: "1px solid rgba(0,0,0,0.1)" }} />
                        <span style={{ fontWeight: 600 }}>{c.name}</span>
                        <span style={{ color: COLORS.muted }}>{c.pct} %</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* ── Et demain ? ── */}
            {tomorrowEntries.length === 0 ? (
              <button
                type="button"
                onClick={() => openQuickPlan(tomorrowKey())}
                className="w-full flex items-center justify-between py-1 text-left mb-6"
              >
                <div>
                  <p className="display" style={{ fontWeight: 700, fontSize: 16 }}>Et demain ?</p>
                  {renderTomorrowForecast()}
                  <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>Rien de prévu</p>
                </div>
                <span className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: COLORS.haze, color: COLORS.ink }}>
                  <Plus size={14} />
                </span>
              </button>
            ) : (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="display" style={{ fontWeight: 700, fontSize: 16 }}>Et demain ?</p>
                    {renderTomorrowForecast()}
                  </div>
                  <button
                    type="button"
                    onClick={() => openQuickPlan(tomorrowKey())}
                    aria-label="Ajouter une tenue pour demain"
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: COLORS.haze, color: COLORS.ink }}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                {tomorrowEntries.map((entry) => (
                  <div key={entry.entryId} className="mb-3 cursor-pointer" onClick={() => { setShowModalPicker(false); setOpenEntryId(entry.entryId); }}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm truncate" style={{ fontWeight: 600 }}>{entry.label}</p>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); askConfirm("Supprimer cette tenue prévue ?", () => removeAgendaEntry(entry.dateStr, entry.entryId)); }}
                        aria-label="Supprimer cette tenue prévue"
                        className="w-6 h-6 rounded-full flex items-center justify-center"
                        style={{ background: "rgba(0,0,0,0.06)" }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {entry.planItems.map((item) => (
                        <div key={item.id} className="rounded-lg overflow-hidden" style={{ background: COLORS.haze }}>
                          {item.photo ? (
                            <img loading="lazy" decoding="async" src={thumbOf(item)} alt={item.name} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
                          ) : (
                            <div style={{ background: item.hex, aspectRatio: "1 / 1" }} />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}


            {/* ── Popup "tenue du jour" ── */}
            {openEntryId !== null && (() => {
              const idx = agendaEntries.findIndex((e) => e.entryId === openEntryId);
              const entry = agendaEntries[idx];
              if (!entry) return null;
              const validated = isPlanValidatedToday(entry.planItems);
              const prevE = agendaEntries[idx - 1];
              const nextE = agendaEntries[idx + 1];
              const go = (e) => { if (e) { setShowModalPicker(false); setOpenEntryId(e.entryId); } };
              return (
                <div
                  onClick={() => setOpenEntryId(null)}
                  className="fixed inset-0 flex items-end justify-center"
                  style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}
                >
                  {/* stopPropagation : un clic à l'intérieur de la popup ne doit pas la fermer. Glisser : tenue précédente / suivante */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    onTouchStart={(e) => { daySwipeX.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
                    onTouchEnd={(e) => {
                      const start = daySwipeX.current;
                      daySwipeX.current = null;
                      if (!start) return;
                      const dx = e.changedTouches[0].clientX - start.x;
                      const dy = Math.abs(e.changedTouches[0].clientY - start.y);
                      if (Math.abs(dx) < 60 || dy > 60) return;
                      go(dx < 0 ? nextE : prevE);
                    }}
                    className="w-full max-w-md px-5 pt-3 pb-8"
                    style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}
                  ><div data-sheet-handle className="flex justify-center -mt-3 pt-3 pb-3" style={{ touchAction: "none", cursor: "grab" }}><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                    <div className="flex items-center justify-between gap-2 mb-4">
                      <button onClick={() => go(prevE)} disabled={!prevE} aria-label="Tenue précédente" className="w-8 h-9 flex items-center justify-center flex-shrink-0" style={{ opacity: prevE ? 0.8 : 0.2 }}>
                        <ChevronDown size={20} style={{ transform: "rotate(90deg)" }} />
                      </button>
                      <div className="flex-1 min-w-0 text-center">
                        <p className="display truncate" style={{ fontWeight: 700, fontSize: 18 }}>{entry.label}</p>
                        <p className="text-xs" style={{ color: COLORS.muted }}>{entry.dateStr === todayKey() ? "Aujourd'hui" : entry.dateStr === tomorrowKey() ? "Demain" : formatAgendaDate(entry.dateStr)}</p>
                      </div>
                      <button onClick={() => go(nextE)} disabled={!nextE} aria-label="Tenue suivante" className="w-8 h-9 flex items-center justify-center flex-shrink-0" style={{ opacity: nextE ? 0.8 : 0.2 }}>
                        <ChevronDown size={20} style={{ transform: "rotate(-90deg)" }} />
                      </button>
                      <button onClick={() => setOpenEntryId(null)} aria-label="Fermer" className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: COLORS.haze }}>
                        <X size={14} />
                      </button>
                    </div>

                    {renderEntryBody(entry, { onLeave: () => setOpenEntryId(null) })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ══════════════════ VUE DRESSING ══════════════════ */}
        {view === "dressing" && (
          <div key={view + (categoryView || "")} className={categoryView ? "slide-right" : slideDir === "right" ? "slide-right" : "slide-left"}>
            {/* En-tête : "Garde-robe" en vue rangées, nom de la catégorie en vue "Tout voir" */}
            {!categoryView ? (
              <div className="flex items-end justify-between mb-6">
                <div>
                  <h1 className="display text-3xl" style={{ fontWeight: 700 }}>Garde-robe</h1>
                  <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
                    {items.length} pièce{items.length > 1 ? "s" : ""}
                    {items.some((i) => i.handmade) && (
                      <>
                        {" · "}
                        <button type="button" onClick={() => { setCategoryView(ALL_ITEMS_VIEW); setCategorySort("faitmain"); }} className="inline-flex items-center gap-1" style={{ color: COLORS.rose, fontWeight: 600 }}>
                          <Scissors size={12} /> {items.filter((i) => i.handmade).length} faite{items.filter((i) => i.handmade).length > 1 ? "s" : ""} main
                        </button>
                      </>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { setShowSearch((v) => !v); setSearchQuery(""); }}
                  aria-label={showSearch ? "Fermer la recherche" : "Rechercher"}
                  className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center"
                  style={{ background: showSearch ? "rgba(0,0,0,0.06)" : "transparent" }}
                >
                  {showSearch ? <X size={20} /> : <Search size={20} />}
                </button>
              </div>
            ) : (
              <div className="mb-5">
                <button
                  type="button"
                  onClick={() => setCategoryView(null)}
                  aria-label="Retour à la garde-robe"
                  className="w-10 h-10 mb-1 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}
                >
                  <ArrowLeft size={20} />
                </button>
                <h1 className="display text-3xl" style={{ fontWeight: 700 }}>{categoryView === ALL_ITEMS_VIEW ? "Toutes les pièces" : CATEGORY_PLURALS[categoryView] || categoryView}</h1>
                <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
                  {categoryItems.length} pièce{categoryItems.length > 1 ? "s" : ""}
                </p>
              </div>
            )}



            {/* Barre de recherche, ouverte avec la loupe */}
            {showSearch && !categoryView && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-full mb-3" style={{ background: "#F3F2EF" }}>
                <Search size={15} style={{ opacity: 0.45 }} />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher un vêtement..."
                  className="flex-1 text-sm outline-none"
                  style={{ background: "transparent" }}
                />
              </div>
            )}

            {/* Tags, sous la recherche (ouverts avec la loupe) : un toucher ouvre toutes les pièces filtrées */}
            {showSearch && !categoryView && items.length > 0 && (
              <div data-no-swipe className="no-scrollbar -mx-5 px-5 flex gap-2 overflow-x-auto mb-5">
                {[
                  { id: "favoris", label: "Favoris", icon: <Heart size={13} color={COLORS.rose} fill={COLORS.rose} /> },
                  { id: "faitmain", label: "Fait main", icon: <Scissors size={13} color={COLORS.rose} /> },
                  { id: "jamais", label: "Jamais portés" },
                  { id: "mois", label: "Portées ce mois-ci" },
                  ...TAG_SORTS,
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { setCategoryView(ALL_ITEMS_VIEW); setCategorySort(t.id); }}
                    className="flex-shrink-0 px-4 h-9 rounded-full text-sm flex items-center gap-1.5"
                    style={{ border: `1px solid ${COLORS.line}`, color: COLORS.ink }}
                  >
                    {t.icon}{t.label}
                  </button>
                ))}
              </div>
            )}


            {searchQuery.trim() && !categoryView ? (
              /* ── Résultats de recherche ── */
              searchResults.length === 0 ? (
                <p className="text-sm py-10 text-center" style={{ color: COLORS.muted }}>Aucun résultat</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {searchResults.map((item) => renderItemTile(item, { width: "100%", aspectRatio: "1 / 1" }))}
                </div>
              )
            ) : !categoryView ? (
              /* ── Vue en rangées : une rangée par catégorie, qui défile sur le côté ── */
              items.length === 0 ? (
                <p className="text-sm py-10 text-center" style={{ color: COLORS.muted }}>Ta garde-robe est vide</p>
              ) : (
                <div className="flex flex-col gap-7">
                  {CATEGORIES.map((cat) => {
                    const catItems = sortItems(items.filter((i) => i.category === cat), "couleur");
                    if (catItems.length === 0) return null;
                    return (
                      <section key={cat}>
                        <div className="flex items-baseline justify-between mb-3">
                          <h2 className="text-base" style={{ fontWeight: 600, fontFamily: "'Karla', sans-serif" }}>
                            {CATEGORY_PLURALS[cat] || cat}{" "}
                            <span style={{ fontWeight: 400, color: COLORS.muted }}>· {catItems.length}</span>
                          </h2>
                          <button
                            type="button"
                            onClick={() => { setCategoryView(cat); setCategorySort("couleur"); }}
                            className="text-sm py-2"
                            style={{ color: COLORS.rose, fontWeight: 500 }}
                          >
                            Tout voir
                          </button>
                        </div>
                        <div data-no-swipe className="no-scrollbar -mx-5 px-5 flex gap-2.5 overflow-x-auto">
                          {catItems.map((item) => renderItemTile(item, { width: 112, height: 112 }))}
                        </div>
                      </section>
                    );
                  })}

                </div>
              )
            ) : (
              /* ── Vue "Tout voir" d'une catégorie : grille à 3 colonnes ── */
              <div>
                <div data-no-swipe className="no-scrollbar -mx-5 px-5 flex gap-2 overflow-x-auto mb-4">
                  {(categoryView === ALL_ITEMS_VIEW ? [...ALL_SORTS, ...TAG_SORTS] : [...CATEGORY_SORTS, ...TAG_SORTS]).map((s) => {
                    const active = categorySort === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setCategorySort(s.id)}
                        className="flex-shrink-0 px-4 rounded-full text-sm"
                        style={{
                          height: 36,
                          background: active ? COLORS.ink : "transparent",
                          color: active ? "white" : COLORS.ink,
                          border: `1px solid ${active ? COLORS.ink : COLORS.line}`,
                          fontWeight: active ? 500 : 400,
                        }}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
                {categoryItems.length === 0 ? (
                  <p className="text-sm py-10 text-center" style={{ color: COLORS.muted }}>
                    {categorySort === "favoris" ? "Aucun favori" : categorySort === "jamais" ? "Tout a déjà été porté" : categorySort === "mois" ? "Rien de porté ce mois-ci" : categorySort === "faitmain" ? "Aucune pièce faite main ici" : categorySort.includes(":") ? `Aucune pièce taguée « ${categorySort.slice(2)} »` : "Vide"}
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {categoryItems.map((item) => renderItemTile(item, { width: "100%", aspectRatio: "1 / 1" }))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ VUE TENUES ══════════════════ */}
        {view === "tenues" && (
          <div key={view} className={slideDir === "right" ? "slide-right" : "slide-left"}>
            {(
            <div className="flex items-end justify-between mb-6">
              <div>
                <h1 className="display text-3xl" style={{ fontWeight: 700 }}>Tenues</h1>
                <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
                  {hasOutfitFilter ? `${filteredOutfits.length} sur ${outfits.length}` : outfits.length} tenue{outfits.length > 1 ? "s" : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (showOutfitSearch) { setOutfitQuery(""); setOutfitTagFilter({ fav: false, weather: [], occasions: [] }); }
                  setShowOutfitSearch((v) => !v);
                }}
                aria-label={showOutfitSearch ? "Fermer la recherche" : "Rechercher"}
                className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center"
                style={{ background: showOutfitSearch ? "rgba(0,0,0,0.06)" : "transparent" }}
              >
                {showOutfitSearch ? <X size={20} /> : <Search size={20} />}
              </button>
            </div>
            )}



            {(
            <>
            {outfits.length === 0 ? (
              <p className="text-sm py-10 text-center" style={{ color: COLORS.muted }}>Aucune tenue</p>
            ) : (
              <div className="flex flex-col gap-5">
                {/* ── "Parfaites pour aujourd'hui" : cadre qui s'ouvre quand on le touche ── */}
                {todayOutfitTag && weather && (
                  <div className="rounded-2xl" style={{ background: COLORS.haze }}>
                    <button
                      type="button"
                      onClick={() => setTodayPicksOpen((v) => !v)}
                      aria-expanded={todayPicksOpen}
                      className="w-full flex items-center justify-between gap-3 p-4 text-left"
                    >
                      <span className="min-w-0">
                        <span className="display block" style={{ fontWeight: 700, fontSize: 16 }}>Parfaites pour aujourd'hui</span>
                        <span className="text-xs" style={{ color: COLORS.muted }}>
                          {todayOutfitTag} · {weather.min}° / {weather.max}° · {todayOutfits.length} tenue{todayOutfits.length > 1 ? "s" : ""}
                        </span>
                      </span>
                      <ChevronDown size={20} style={{ flexShrink: 0, transition: "transform 0.2s", transform: todayPicksOpen ? "rotate(180deg)" : "none" }} />
                    </button>
                    {todayPicksOpen && (
                      <div className="px-4 pb-4">
                        {todayOutfits.length === 0 ? (
                          <p className="text-sm" style={{ color: COLORS.muted }}>Aucune tenue taguée « {todayOutfitTag} » pour l'instant</p>
                        ) : (
                          <div data-no-swipe className="no-scrollbar -mx-4 px-4 py-0.5 flex gap-2.5 overflow-x-auto">
                            {todayOutfits.map((o) => renderOutfitTile(o, 104))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Recherche + tags (ouverts avec la loupe) ── */}
                {showOutfitSearch && (
                <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-full" style={{ background: "#F3F2EF" }}>
                  <Search size={15} style={{ opacity: 0.45 }} />
                  <input
                    autoFocus
                    value={outfitQuery}
                    onChange={(e) => setOutfitQuery(e.target.value)}
                    placeholder="Rechercher une tenue ou une pièce..."
                    className="flex-1 text-sm outline-none"
                    style={{ background: "transparent" }}
                  />
                </div>
                <div data-no-swipe className="no-scrollbar -mx-5 px-5 flex gap-2 overflow-x-auto">
                  {[
                    { group: "fav", value: "fav", label: "Favorites", active: outfitTagFilter.fav },
                    ...WEATHER_TAGS.map((w) => ({ group: "weather", value: w, label: w, active: outfitTagFilter.weather.includes(w) })),
                    ...OCCASIONS.map((o) => ({ group: "occasions", value: o, label: o, active: outfitTagFilter.occasions.includes(o) })),
                  ].map((t) => (
                    <button
                      key={t.group + t.value}
                      type="button"
                      onClick={() => toggleOutfitFilter(t.group, t.value)}
                      aria-pressed={t.active}
                      className="flex-shrink-0 flex items-center gap-1.5 px-4 rounded-full text-sm"
                      style={{
                        height: 36,
                        background: t.active ? COLORS.ink : "transparent",
                        color: t.active ? "white" : COLORS.ink,
                        border: `1px solid ${t.active ? COLORS.ink : COLORS.line}`,
                      }}
                    >
                      {t.group === "fav" && <Heart size={13} fill={t.active ? "white" : "none"} />}
                      {t.label}
                    </button>
                  ))}
                </div>
                </div>
                )}

                {/* ── Toutes les tenues, en grille ── */}
                {filteredOutfits.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-sm mb-3" style={{ color: COLORS.muted }}>Aucune tenue trouvée</p>
                    <button type="button" onClick={() => { setOutfitTagFilter({ fav: false, weather: [], occasions: [] }); setOutfitQuery(""); }} className="text-sm" style={{ color: COLORS.rose, fontWeight: 500 }}>
                      Tout afficher
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                    {filteredOutfits.map((o) => renderOutfitTile(o))}
                  </div>
                )}
              </div>
            )}
            </>
            )}


          </div>
        )}

        {/* ══════════════════ VUE AGENDA ══════════════════ */}
        {view === "agenda" && (
          <div key={view} className={slideDir === "right" ? "slide-right" : "slide-left"}>
            <h1 className="display text-3xl mb-4" style={{ fontWeight: 700 }}>Agenda</h1>

            {/* Calendrier | Carnet */}
            <div className="flex p-1 mb-6 rounded-full" style={{ background: COLORS.haze }}>
              {[["calendrier", "Calendrier"], ["carnet", "Carnet"]].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAgendaTab(key)}
                  className="flex-1 h-9 rounded-full text-sm"
                  style={{ background: agendaTab === key ? "#FFFFFF" : "transparent", fontWeight: agendaTab === key ? 700 : 500, color: agendaTab === key ? COLORS.ink : COLORS.muted, boxShadow: agendaTab === key ? "0 1px 4px rgba(0,0,0,0.08)" : "none" }}
                >
                  {label}
                </button>
              ))}
            </div>

            {items.length === 0 && (
              <p className="text-sm mb-5" style={{ color: COLORS.muted }}>Ajoute d'abord des vêtements.</p>
            )}

            {agendaTab === "carnet" && (() => {
              const shots = agendaEntries.filter((e) => e.wornPhoto).sort((a, b) => b.dateStr.localeCompare(a.dateStr) || String(b.entryId).localeCompare(String(a.entryId)));
              if (shots.length === 0) {
                return (
                  <div className="flex flex-col items-center text-center gap-2 py-12 px-6">
                    <span className="w-12 h-12 rounded-full flex items-center justify-center mb-1" style={{ background: "#FDE8E5" }}>
                      <Camera size={20} color={COLORS.rose} />
                    </span>
                    <p className="display" style={{ fontWeight: 700, fontSize: 17 }}>Ton carnet est vide</p>
                    <p className="text-sm" style={{ color: COLORS.muted }}>Prends-toi en photo avec ta tenue du jour.</p>
                  </div>
                );
              }
              return (
                <>
                  <p className="text-sm mb-3" style={{ color: COLORS.muted }}>{shots.length} tenue{shots.length > 1 ? "s" : ""} portée{shots.length > 1 ? "s" : ""}</p>
                  <div style={{ columnCount: 2, columnGap: 10 }}>
                    {shots.map((entry) => (
                      <button
                        key={entry.entryId}
                        type="button"
                        onClick={() => setCarnetViewId(entry.entryId)}
                        aria-label={`${formatShortDate(entry.dateStr)} — ${entry.label}`}
                        className="relative w-full block mb-2.5 overflow-hidden"
                        style={{ borderRadius: 18, background: COLORS.haze, breakInside: "avoid" }}
                      >
                        <img loading="lazy" decoding="async" src={entry.wornPhoto} alt="" style={{ width: "100%", display: "block" }} />
                        <span className="absolute text-xs flex items-center gap-1.5" style={{ left: 8, bottom: 8, padding: "3px 9px", borderRadius: 999, background: "rgba(255,255,255,0.92)", fontWeight: 600 }}>
                          {formatShortDate(entry.dateStr)}
                          {entry.planItems.length > 0 && renderPaletteDots(entriesPalette([entry], 4), 10, "#FFFFFF")}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              );
            })()}

            {agendaTab === "calendrier" && (<>
            {/* ── Calendrier ── */}
            <div className="p-4 rounded-2xl mb-6" style={{ background: COLORS.haze }}>
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                  className="w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: COLORS.ivory }}
                >
                  <ArrowLeft size={13} />
                </button>
                <p className="display text-sm" style={{ fontWeight: 700, textTransform: "capitalize" }}>
                  {calendarMonth.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
                </p>
                <button
                  onClick={() => setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                  className="w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: COLORS.ivory }}
                >
                  <ArrowLeft size={13} style={{ transform: "rotate(180deg)" }} />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-0.5 mb-0.5">
                {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
                  <p key={i} className="text-center text-[9px]" style={{ opacity: 0.4 }}>{d}</p>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {buildCalendarCells(calendarMonth).map((day, i) => {
                  if (day === null) return <div key={i} />;
                  const dateKey = toDateKey(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
                  const dayEntries = agendaEntries.filter((e) => e.dateStr === dateKey);
                  const hasEntries = dayEntries.length > 0;
                  const dayPal = entriesPalette(dayEntries, 3);
                  const isToday = dateKey === todayKey();
                  return (
                    <button
                      key={i}
                      onClick={() => { setDayViewReadOnly(false); setDayViewDate(dateKey); }}
                      className="aspect-square rounded-md flex flex-col items-center justify-center relative text-[11px]"
                      style={{
                        background: isToday ? COLORS.ink : hasEntries ? "#FFFFFF" : "transparent",
                        color: isToday ? "white" : COLORS.ink,
                        fontWeight: hasEntries || isToday ? 700 : 400,
                      }}
                    >
                      <span style={{ marginTop: hasEntries ? -6 : 0 }}>{day}</span>
                      {/* Mini palette de la tenue du jour (ou point corail si c'est juste une photo) */}
                      {hasEntries && (
                        <span className="absolute flex" style={{ bottom: 4, paddingLeft: 3 }}>
                          {(dayPal.length ? dayPal : [COLORS.rose]).map((hex) => (
                            <span key={hex} style={{ width: 7, height: 7, borderRadius: 4, background: hex, marginLeft: -3, boxShadow: `0 0 0 1px ${isToday ? COLORS.ink : "#FFFFFF"}` }} />
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Une rangée par mois (ouverte ou fermée d'un toucher sur le mois) ── */}
            <div className="flex flex-col gap-4">
              {agendaMonthGroups.map((group) => (
                <section key={group.key}>
                  <button
                    type="button"
                    onClick={() => toggleMonth(group.key)}
                    aria-expanded={isMonthOpen(group.key)}
                    className="w-full flex items-center justify-between py-1"
                  >
                    <h2 className="text-base" style={{ fontWeight: 600 }}>
                      {formatMonthLabel(group.key)}{" "}
                      <span style={{ fontWeight: 400, color: COLORS.muted }}>· {group.entries.length}</span>
                    </h2>
                    <ChevronDown size={18} style={{ color: COLORS.muted, transition: "transform 0.2s", transform: isMonthOpen(group.key) ? "rotate(180deg)" : "none" }} />
                  </button>
                  {isMonthOpen(group.key) && (
                  <div data-no-swipe className="no-scrollbar -mx-5 px-5 mt-2 flex gap-2.5 overflow-x-auto">
                    {group.entries.map((entry) => {
                      const isPast = entry.dateStr < todayKey();
                      const isToday = entry.dateStr === todayKey();
                      const shown = entry.planItems.slice(0, 4);
                      return (
                        <button
                          key={entry.entryId}
                          type="button"
                          onClick={() => { setDayViewReadOnly(true); setDayViewDate(entry.dateStr); }}
                          aria-label={`${formatShortDate(entry.dateStr)} — ${entry.label}`}
                          className="flex-shrink-0 text-left"
                          style={{ width: 104, opacity: isPast ? 0.55 : 1 }}
                        >
                          <div className="relative">
                          <div
                            className="rounded-2xl overflow-hidden"
                            style={{
                              width: 104,
                              height: 104,
                              background: COLORS.haze,
                              display: "grid",
                              gridTemplateColumns: shown.length > 1 ? "1fr 1fr" : "1fr",
                              gridTemplateRows: shown.length > 2 ? "1fr 1fr" : "1fr",
                              gap: shown.length > 1 ? 2 : 0,
                              outline: isToday ? `2px solid ${COLORS.rose}` : "none",
                              outlineOffset: 2,
                            }}
                          >
                            {shown.map((item) => (
                              item.photo ? (
                                <img loading="lazy" decoding="async" key={item.id} src={thumbOf(item)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                              ) : (
                                <div key={item.id} style={{ background: item.hex, width: "100%", height: "100%" }} />
                              )
                            ))}
                          </div>
                          </div>
                          <p className="text-xs mt-1.5 flex items-center justify-between gap-1" style={{ color: isToday ? COLORS.rose : COLORS.muted, fontWeight: isToday ? 600 : 400 }}>
                            <span className="truncate">{formatShortDate(entry.dateStr)}</span>
                            {entry.planItems.length > 0 && renderPaletteDots(entriesPalette([entry], 4), 9)}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                  )}
                </section>
              ))}
            </div>
            </>)}

            {/* ── Visionneuse du Carnet : uniquement les photos portées, avec leur palette ── */}
            {carnetViewId !== null && (() => {
              const shots = carnetShots();
              const idx = shots.findIndex((e) => e.entryId === carnetViewId);
              const shot = shots[idx];
              if (!shot) return null;
              const newer = shots[idx - 1]; // la grille va de la plus récente à la plus ancienne
              const older = shots[idx + 1];
              const pal = entriesPalette([shot], 6);
              return (
                <div onClick={() => setCarnetViewId(null)} className="fixed inset-0 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}>
                  <div
                    onClick={(e) => e.stopPropagation()}
                    onTouchStart={(e) => { daySwipeX.current = e.target.closest("[data-no-swipe]") ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
                    onTouchEnd={(e) => {
                      const start = daySwipeX.current;
                      daySwipeX.current = null;
                      if (!start) return;
                      const dx = e.changedTouches[0].clientX - start.x;
                      const dy = Math.abs(e.changedTouches[0].clientY - start.y);
                      if (Math.abs(dx) < 60 || dy > 60) return;
                      const target = dx < 0 ? older : newer;
                      if (target) setCarnetViewId(target.entryId);
                    }}
                    className="w-full max-w-md px-5 pt-3 pb-8"
                    style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}
                  >
                    <div data-sheet-handle className="flex justify-center -mt-3 pt-3 pb-3" style={{ touchAction: "none", cursor: "grab" }}><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                    <div className="flex items-center justify-between gap-2 mb-4">
                      <button onClick={() => newer && setCarnetViewId(newer.entryId)} disabled={!newer} aria-label="Photo plus récente" className="w-8 h-9 flex items-center justify-center flex-shrink-0" style={{ opacity: newer ? 0.8 : 0.2 }}>
                        <ChevronDown size={20} style={{ transform: "rotate(90deg)" }} />
                      </button>
                      <div className="flex-1 min-w-0 text-center">
                        <p className="text-sm font-medium">{shot.dateStr === todayKey() ? "Aujourd'hui" : formatAgendaDate(shot.dateStr)}</p>
                        <p className="text-xs" style={{ color: COLORS.muted }}>{idx + 1} / {shots.length}</p>
                      </div>
                      <button onClick={() => older && setCarnetViewId(older.entryId)} disabled={!older} aria-label="Photo plus ancienne" className="w-8 h-9 flex items-center justify-center flex-shrink-0" style={{ opacity: older ? 0.8 : 0.2 }}>
                        <ChevronDown size={20} style={{ transform: "rotate(-90deg)" }} />
                      </button>
                      <button onClick={() => setCarnetViewId(null)} aria-label="Fermer" className="w-8 h-8 ml-1.5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: COLORS.haze }}>
                        <X size={14} />
                      </button>
                    </div>
                    <img src={shot.wornPhoto} alt={`Tenue portée — ${shot.label}`} style={{ width: "100%", maxHeight: "62vh", objectFit: "contain", borderRadius: 20, display: "block", background: COLORS.haze, opacity: uploadingWornFor === shot.entryId ? 0.5 : 1 }} />
                    <div className="flex justify-end gap-4 mt-2">
                      <label className="text-xs cursor-pointer" style={{ color: COLORS.muted, fontWeight: 600 }}>
                        {uploadingWornFor === shot.entryId ? "Envoi…" : "Changer la photo"}
                        <input type="file" accept="image/*" onChange={(ev) => handleWornPhoto(ev, shot.dateStr, shot.entryId)} className="hidden" />
                      </label>
                      <button type="button" onClick={() => askConfirm("Retirer cette photo du Carnet ?", () => { removeEntryWornPhoto(shot.dateStr, shot.entryId); setCarnetViewId(older ? older.entryId : newer ? newer.entryId : null); })} className="text-xs" style={{ color: COLORS.muted, fontWeight: 600 }}>
                        Retirer
                      </button>
                    </div>
                    {shot.planItems.length > 0 && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm truncate" style={{ fontWeight: 600 }}>{shot.label}</p>
                          {renderPaletteDots(pal, 20)}
                        </div>
                        <button type="button" onClick={() => setCarnetShowPieces((v) => !v)} className="flex items-center gap-1 text-xs mt-1" style={{ color: COLORS.rose, fontWeight: 700 }}>
                          {carnetShowPieces ? "Masquer" : "Voir"} les pièces
                          <ChevronDown size={14} style={{ transition: "transform 0.2s", transform: carnetShowPieces ? "rotate(180deg)" : "none" }} />
                        </button>
                        {carnetShowPieces && <div className="mt-3">{renderPieceThumbs(shot.planItems, 5)}</div>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* ── Popup "jour" : détail d'une date cliquée dans le calendrier, avec glissement entre jours ── */}
            {dayViewDate && (() => {
              const dayEntries = agendaEntries.filter((e) => e.dateStr === dayViewDate);
              return (
                <div
                  onClick={() => setDayViewDate(null)}
                  className="fixed inset-0 flex items-end justify-center"
                  style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}
                >
                  <div
                    onClick={(e) => e.stopPropagation()}
                    // Glisser à gauche / à droite : tenue suivante / précédente
                    onTouchStart={(e) => { daySwipeX.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
                    onTouchEnd={(e) => {
                      const start = daySwipeX.current;
                      daySwipeX.current = null;
                      if (!start) return;
                      const dx = e.changedTouches[0].clientX - start.x;
                      const dy = Math.abs(e.changedTouches[0].clientY - start.y);
                      if (Math.abs(dx) < 60 || dy > 60) return;
                      const target = dx < 0 ? nextPlannedDate(dayViewDate) : prevPlannedDate(dayViewDate);
                      if (target) setDayViewDate(target);
                    }}
                    className="w-full max-w-md px-5 pt-3 pb-8"
                    style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}
                  ><div data-sheet-handle className="flex justify-center -mt-3 pt-3 pb-3" style={{ touchAction: "none", cursor: "grab" }}><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                    <div className="flex items-center justify-between mb-4">
                      <button onClick={() => prevPlannedDate(dayViewDate) && setDayViewDate(prevPlannedDate(dayViewDate))} disabled={!prevPlannedDate(dayViewDate)} aria-label="Tenue précédente" className="w-8 h-9 flex items-center justify-center" style={{ opacity: prevPlannedDate(dayViewDate) ? 0.8 : 0.2 }}>
                        <ChevronDown size={20} style={{ transform: "rotate(90deg)" }} />
                      </button>
                      <p className="text-sm font-medium text-center" style={{ flex: 1 }}>
                        {dayViewDate === todayKey() ? "Aujourd'hui" : formatAgendaDate(dayViewDate)}
                      </p>
                      <button onClick={() => nextPlannedDate(dayViewDate) && setDayViewDate(nextPlannedDate(dayViewDate))} disabled={!nextPlannedDate(dayViewDate)} aria-label="Tenue suivante" className="w-8 h-9 flex items-center justify-center" style={{ opacity: nextPlannedDate(dayViewDate) ? 0.8 : 0.2 }}>
                        <ChevronDown size={20} style={{ transform: "rotate(-90deg)" }} />
                      </button>
                      <button onClick={() => setDayViewDate(null)} aria-label="Fermer" className="w-8 h-8 ml-1.5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: COLORS.haze }}>
                        <X size={14} />
                      </button>
                    </div>

                    {dayEntries.length === 0 ? (
                      <p className="text-xs py-4 text-center" style={{ opacity: 0.5 }}>Rien de prévu</p>
                    ) : (
                      <div className="space-y-3 mb-4">
                        {dayEntries.map((entry) => renderEntryBody(entry, { readOnly: dayViewReadOnly }))}
                      </div>
                    )}

                    {!dayViewReadOnly && (
                    <button
                      onClick={() => { const d = dayViewDate; setDayViewDate(null); openQuickPlan(d); }}
                      className="w-full flex items-center justify-center gap-1.5 px-5 h-12 rounded-full text-sm font-bold"
                      style={{ border: `1px solid ${COLORS.gold}`, color: COLORS.gold }}
                    >
                      <Plus size={14} /> Planifier une tenue pour ce jour
                    </button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
            {/* ── Formulaires d'ajout (vêtement, tenue) : globaux, ils s'ouvrent par-dessus la page en cours ── */}
            {showAddForm && (
              <div
                onClick={() => setShowAddForm(false)}
                className="fixed inset-0 flex items-end justify-center"
                style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}
              >
                <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md px-5 pt-3 pb-8" style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}><div data-sheet-handle className="flex justify-center -mt-3 pt-3 pb-3" style={{ touchAction: "none", cursor: "grab" }}><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                  <div className="flex items-center justify-between mb-4">
                    <p className="display" style={{ fontWeight: 700, fontSize: 19 }}>Ajouter un vêtement</p>
                    <button onClick={() => setShowAddForm(false)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                      <X size={14} />
                    </button>
                  </div>
                  <form onSubmit={(e) => { if (addItem(e)) setShowAddForm(false); }} className="flex flex-wrap gap-3 items-end">
                    <div className="flex-1 min-w-[140px]">
                      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nom du vêtement" className="w-full px-4 py-2.5 rounded-xl text-sm" style={{ border: `1px solid ${COLORS.line}`, outline: "none" }} />
                    </div>
                    <div>
                      <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="px-4 py-2.5 rounded-xl text-sm" style={{ border: `1px solid ${COLORS.line}` }}>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="flex items-center justify-center rounded cursor-pointer overflow-hidden" style={{ width: 40, height: 36, border: `1px solid ${COLORS.line}`, background: form.photo ? "transparent" : "#FAFAFA" }}>
                        {form.photo ? <img src={form.photo} alt="Aperçu" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Camera size={15} style={{ opacity: 0.4 }} />}
                        <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
                      </label>
                    </div>
                    <div>
                      {(form.extraHexes || []).length > 0 && <span className="inline-flex align-middle mr-1.5">{renderPaletteDots(form.extraHexes, 18)}</span>}
                      <input type="color" value={form.hex} onChange={(e) => setForm({ ...form, hex: e.target.value })} className="w-10 h-9 rounded cursor-pointer" style={{ border: `1px solid ${COLORS.line}` }} />
                    </div>
                    {/* Motif détecté sur la photo (touche pour corriger) */}
                    {form.photo && (typeof form.patternScore === "number" || typeof form.pattern === "boolean") && (
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, pattern: !isPatterned(f) }))}
                        className="h-9 px-3 rounded-full text-xs flex items-center gap-1.5"
                        style={{ border: `1px solid ${COLORS.line}`, color: isPatterned(form) ? COLORS.ink : COLORS.muted, fontWeight: 600 }}
                        aria-label="Motif : toucher pour changer"
                      >
                        <span style={{ width: 12, height: 12, borderRadius: 3, background: isPatterned(form) ? "repeating-linear-gradient(45deg, #FF4B33 0 2px, #FFFFFF 2px 4px)" : "#E2E0DC" }} />
                        {isPatterned(form) ? "À motifs" : "Uni"}
                      </button>
                    )}
                    <div className="w-full">
                      <div className="flex gap-1.5 flex-wrap">
                        {WEATHER_TAGS.map((w) => (
                          <button type="button" key={w} onClick={() => toggleFormWeather(w)} className="px-4 h-9 rounded-full text-sm" style={{
                            background: form.weather.includes(w) ? COLORS.ink : "transparent",
                            color: form.weather.includes(w) ? "white" : COLORS.ink,
                            border: `1px solid ${form.weather.includes(w) ? COLORS.ink : COLORS.line}`,
                          }}>
                            {w}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="w-full">
                      <div className="flex gap-1.5 flex-wrap">
                        {OCCASIONS.map((o) => (
                          <button type="button" key={o} onClick={() => toggleFormOccasion(o)} className="px-4 h-9 rounded-full text-sm" style={{
                            background: form.occasions.includes(o) ? COLORS.ink : "transparent",
                            color: form.occasions.includes(o) ? "white" : COLORS.ink,
                            border: `1px solid ${form.occasions.includes(o) ? COLORS.ink : COLORS.line}`,
                          }}>
                            {o}
                          </button>
                        ))}
                      </div>
                    </div>
                    {itemDup && (
                      <div className="w-full p-3 rounded-2xl" style={{ background: "#FDE8E5" }}>
                        <p className="text-sm mb-2" style={{ fontWeight: 700 }}>Tu l'as peut-être déjà ?</p>
                        {itemDup.map((d) => (
                          <div key={d.id} className="flex items-center gap-2.5 mb-2">
                            <span className="overflow-hidden flex-shrink-0" style={{ width: 44, height: 44, borderRadius: 12, background: d.photo ? "#FFFFFF" : d.hex }}>
                              {d.photo && <img src={thumbOf(d)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                            </span>
                            <span className="flex-1 text-sm truncate">{d.name}</span>
                            <button type="button" onClick={() => { setShowAddForm(false); setItemDup(null); changeView("dressing"); setDetailItemId(d.id); }} className="text-sm" style={{ color: COLORS.rose, fontWeight: 700 }}>Voir</button>
                          </div>
                        ))}
                        <button type="button" onClick={() => { if (addItem(null, true)) setShowAddForm(false); }} className="w-full h-10 rounded-full text-sm mt-1" style={{ background: "#FFFFFF", fontWeight: 600 }}>
                          Non, c'est une autre pièce : ajouter
                        </button>
                      </div>
                    )}
                    <div className="w-full flex items-center justify-between py-1">
                      <span className="flex items-center gap-2 text-sm" style={{ fontWeight: 600 }}>
                        <Scissors size={15} color={COLORS.rose} /> Fait main
                      </span>
                      {renderSwitch(!!form.handmade, () => setForm((f) => ({ ...f, handmade: !f.handmade })), "Fait main")}
                    </div>
                    <button type="submit" className="w-full flex items-center justify-center gap-1.5 px-5 h-12 rounded-full text-sm font-bold text-white" style={{ background: COLORS.rose }}>
                      <Plus size={16} /> Ajouter
                    </button>
                  </form>
                </div>
              </div>
            )}

            {showOutfitForm && (
              <div
                onClick={() => setShowOutfitForm(false)}
                className="fixed inset-0 flex items-end justify-center"
                style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}
              >
                {/* Panneau qui monte du bas de l'écran */}
                <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md px-5 pt-2" style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}>
                  <div data-sheet-handle className="flex justify-center -mt-2 pt-2 pb-2" style={{ touchAction: "none", cursor: "grab" }}>
                    <span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} />
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="display" style={{ fontWeight: 700, fontSize: 19 }}>Créer une tenue</p>
                    <button type="button" onClick={() => setShowOutfitForm(false)} aria-label="Fermer" className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                      <X size={14} />
                    </button>
                  </div>
                  <form onSubmit={saveOutfit}>
                    {createOutfitStep === "select" && (
                      <>
                        {/* Une rangée par catégorie, qui défile sur le côté, comme la Garde-robe.
                            Les photos ne se chargent qu'en arrivant à l'écran (loading="lazy"). */}
                        <div className="flex flex-col gap-5 pb-4">
                          {CATEGORIES.map((cat) => {
                            const catItems = sortItems(items.filter((i) => i.category === cat), "couleur");
                            if (catItems.length === 0) return null;
                            return (
                              <section key={cat}>
                                <p className="text-sm mb-2" style={{ fontWeight: 600 }}>
                                  {CATEGORY_PLURALS[cat] || cat}{" "}
                                  <span style={{ fontWeight: 400, color: COLORS.muted }}>· {catItems.length}</span>
                                </p>
                                <div data-no-swipe className="no-scrollbar -mx-5 px-5 py-1 flex gap-2 overflow-x-auto">
                                  {catItems.map((item) => {
                                    const isSelected = selectedIds.includes(item.id);
                                    return (
                                      <button
                                        type="button"
                                        key={item.id}
                                        onClick={() => toggleSelected(item.id)}
                                        aria-label={item.name}
                                        aria-pressed={isSelected}
                                        className="relative flex-shrink-0 overflow-hidden"
                                        style={{ width: 84, height: 84, borderRadius: 14, background: COLORS.haze, boxShadow: isSelected ? `0 0 0 2px ${COLORS.rose}` : "none" }}
                                      >
                                        {item.photo ? (
                                          <img src={thumbOf(item)} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                                        ) : (
                                          <div style={{ background: item.hex, width: "100%", height: "100%" }} />
                                        )}
                                        {isSelected && (
                                          <span className="absolute w-5 h-5 rounded-full flex items-center justify-center" style={{ top: 5, right: 5, background: COLORS.rose }}>
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
                                          </span>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              </section>
                            );
                          })}
                        </div>

                        {/* Bandeau collé en bas : aperçu de la sélection + Suivant */}
                        <div className="-mx-5 px-5 pt-3 pb-6 flex items-center gap-3" style={{ position: "sticky", bottom: 0, background: "#FFFFFF", borderTop: `1px solid ${COLORS.line}` }}>
                          {selectedIds.length > 0 && (
                            <div className="flex flex-shrink-0" style={{ paddingLeft: 8 }}>
                              {selectedIds.slice(0, 4).map((id) => {
                                const item = items.find((i) => i.id === id);
                                if (!item) return null;
                                return (
                                  <div key={id} className="overflow-hidden" style={{ width: 40, height: 40, borderRadius: 10, marginLeft: -8, boxShadow: "0 0 0 2px #FFFFFF", background: item.hex }}>
                                    {item.photo && <img loading="lazy" decoding="async" src={thumbOf(item)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => setCreateOutfitStep("summary")}
                            disabled={selectedIds.length === 0}
                            className="flex-1 rounded-full text-white"
                            style={{ height: 48, background: COLORS.rose, opacity: selectedIds.length === 0 ? 0.4 : 1, fontWeight: 600 }}
                          >
                            {selectedIds.length === 0 ? "Choisis tes pièces" : `Suivant · ${selectedIds.length}`}
                          </button>
                        </div>
                      </>
                    )}

                    {createOutfitStep === "summary" && (
                      <>
                        <button
                          type="button"
                          onClick={() => setCreateOutfitStep("select")}
                          className="flex items-center gap-1.5 text-xs mb-3"
                          style={{ opacity: 0.6 }}
                        >
                          <ArrowLeft size={13} /> Modifier la sélection
                        </button>

                        <div className="grid grid-cols-3 gap-2 mb-4">
                          {selectedIds.map((id) => {
                            const item = items.find((i) => i.id === id);
                            if (!item) return null;
                            return (
                              <div key={item.id} className="rounded-xl overflow-hidden" style={{ background: COLORS.haze }}>
                                {item.photo ? (
                                  <img loading="lazy" decoding="async" src={thumbOf(item)} alt={item.name} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
                                ) : (
                                  <div style={{ background: item.hex, aspectRatio: "1 / 1" }} />
                                )}
                              </div>
                            );
                          })}
                        </div>

                        <input value={outfitName} onChange={(e) => setOutfitName(e.target.value)} placeholder="Nom de la tenue" className="w-full px-4 py-2.5 rounded-xl text-sm mb-3" style={{ border: `1px solid ${COLORS.line}`, outline: "none" }} />

                        {renderOutfitTagPicker()}

                        {/* Vérifié en direct : l'encadré apparaît dès que la sélection ressemble à une tenue existante */}
                        {(() => {
                          const m = findSimilarOutfit(selectedIds);
                          if (!m) return null;
                          return renderOutfitDupPanel(m, { onView: () => { setShowOutfitForm(false); changeView("tenues"); setDetailOutfitId(m.outfit.id); } });
                        })()}
                        <button type="submit" disabled={!outfitName.trim() || selectedIds.length === 0 || !!(findSimilarOutfit(selectedIds) || {}).exact} className="w-full flex items-center justify-center gap-1.5 px-5 h-12 rounded-full text-sm font-bold text-white" style={{ background: COLORS.rose, opacity: !outfitName.trim() || selectedIds.length === 0 || !!(findSimilarOutfit(selectedIds) || {}).exact ? 0.4 : 1 }}>
                          <Plus size={16} /> Enregistrer la tenue
                        </button>
                        <div className="h-6" />
                      </>
                    )}
                  </form>
                </div>
              </div>
            )}

            {/* ── Paramètres ── */}
            {showSettings && (
              <div onClick={() => setShowSettings(false)} className="fixed inset-0 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.4)", zIndex: 52 }}>
                <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md px-5 pt-3 pb-8" style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}>
                  <div data-sheet-handle className="flex justify-center -mt-3 pt-3 pb-3" style={{ touchAction: "none", cursor: "grab" }}><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="display" style={{ fontWeight: 700, fontSize: 19 }}>Paramètres</p>
                    <button onClick={() => setShowSettings(false)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                      <X size={14} />
                    </button>
                  </div>

                  {/* Prénom */}
                  <div className="flex items-center justify-between gap-3 py-3" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>Prénom</span>
                    <input
                      defaultValue={userName || ""}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== userName) { try { localStorage.setItem("mon-armoire-username", v); } catch {} setUserName(v); } }}
                      className="text-sm text-right rounded-xl px-3"
                      style={{ height: 36, width: 160, background: COLORS.haze, border: "none", outline: "none" }}
                    />
                  </div>

                  {/* Météo */}
                  <div className="flex items-center justify-between gap-3 py-3" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                    <div>
                      <p style={{ fontSize: 15, fontWeight: 600 }}>Météo</p>
                      <p className="text-xs" style={{ color: COLORS.muted }}>
                        {weatherStatus === "granted" ? `Activée${weatherCity ? ` · ${weatherCity}` : ""}` : weatherStatus === "loading" ? "Recherche…" : weatherStatus === "denied" ? "Localisation refusée" : "Pas encore activée"}
                      </p>
                    </div>
                    <button type="button" onClick={requestWeather} className="px-4 h-9 rounded-full text-sm" style={{ background: COLORS.haze, fontWeight: 600 }}>
                      {weatherStatus === "granted" ? "Actualiser" : "Activer"}
                    </button>
                  </div>

                  {/* Synchro */}
                  <div className="flex items-center justify-between gap-3 py-3" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                    <div className="min-w-0">
                      <p style={{ fontSize: 15, fontWeight: 600 }}>Synchro téléphone et ordi</p>
                      <p className="text-xs" style={{ color: syncStatus === "error" || syncStatus === "offline" ? COLORS.rose : COLORS.muted }}>
                        {syncStatus === "off" && "Désactivée"}
                        {syncStatus === "ok" && `Synchronisé · ${formatSyncTime(syncedAt)}`}
                        {(syncStatus === "pending" || syncStatus === "saving") && "Enregistrement en ligne…"}
                        {syncStatus === "offline" && "Hors ligne : gardé sur l'appareil"}
                        {syncStatus === "error" && "En pause"}
                      </p>
                    </div>
                    <button type="button" onClick={() => { setSyncSetup({ code: "", step: syncCode ? "info" : "code", remote: null, busy: false, error: "" }); setShowSyncSheet(true); }} className="px-4 h-9 rounded-full text-sm flex-shrink-0" style={{ background: COLORS.haze, fontWeight: 600 }}>
                      {syncCode ? "Gérer" : "Activer"}
                    </button>
                  </div>

                  {/* Règles du générateur : ouvre une popup à part */}
                  <button type="button" onClick={() => setShowRules(true)} className="w-full flex items-center justify-between gap-3 py-3 text-left" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                    <div>
                      <p style={{ fontSize: 15, fontWeight: 600 }}>Règles du générateur</p>
                      <p className="text-xs" style={{ color: COLORS.muted }}>
                        {Object.values(genRules).filter(Boolean).length} règle{Object.values(genRules).filter(Boolean).length > 1 ? "s" : ""} activée{Object.values(genRules).filter(Boolean).length > 1 ? "s" : ""}
                      </p>
                    </div>
                    <ArrowLeft size={16} color={COLORS.muted} style={{ transform: "rotate(180deg)" }} />
                  </button>

                  {/* Sauvegarde */}
                  <div className="py-3" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                    <p style={{ fontSize: 15, fontWeight: 600 }}>Sauvegarde</p>
                    <p className="text-xs mb-3" style={{ color: COLORS.muted }}>Un fichier avec tes vêtements, tenues et agenda.</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={exportBackup} className="flex-1 h-10 rounded-full text-sm" style={{ background: COLORS.ink, color: "#FFFFFF", fontWeight: 600 }}>
                        Sauvegarder
                      </button>
                      <label className="flex-1 h-10 rounded-full text-sm flex items-center justify-center cursor-pointer" style={{ background: COLORS.haze, fontWeight: 600 }}>
                        Restaurer
                        <input type="file" accept="application/json,.json" onChange={importBackup} className="hidden" />
                      </label>
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-2 pt-5">
                    <PliLogo size={22} />
                    <span className="text-xs" style={{ color: COLORS.muted }}>pli · pli-carnet.vercel.app</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Règles du générateur ── */}
            {showRules && (
              <div onClick={() => setShowRules(false)} className="fixed inset-0 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.4)", zIndex: 54 }}>
                <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md px-5 pt-3 pb-8" style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}>
                  <div data-sheet-handle className="flex justify-center -mt-3 pt-3 pb-3" style={{ touchAction: "none", cursor: "grab" }}><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="display" style={{ fontWeight: 700, fontSize: 19 }}>Règles du générateur</p>
                    <button onClick={() => setShowRules(false)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                      <X size={14} />
                    </button>
                  </div>
                  <p className="text-xs mb-5" style={{ color: COLORS.muted }}>Les suggestions respectent les règles activées, dès que ta garde-robe le permet.</p>
                    <div className="flex flex-col gap-3.5">
                      {[
                        ["onePattern", "Un seul motif par tenue", "Jamais deux pièces à motifs ensemble (accessoires à part)"],
                        ["max3Colors", "3 couleurs maximum", "Le noir, le blanc, le gris et le beige ne comptent pas"],
                        ["oneBold", "Une seule couleur forte", "Une pièce vive, le reste plus doux"],
                        ["colorRecall", "Rappel de couleur", "Chaussures ou accessoire reprennent une couleur de la tenue"],
                        ["contrast", "Contraste clair / foncé", "Pas de tout sombre ni de tout pâle (sauf ton sur ton)"],
                        ["oldSchool", "La vieille école", "Pas de noir avec du marine, ni avec du marron"],
                      ].map(([key, title, sub]) => (
                        <div key={key} className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm">{title}</p>
                            <p className="text-xs" style={{ color: COLORS.muted }}>{sub}</p>
                          </div>
                          {renderSwitch(!!genRules[key], () => setGenRule(key, !genRules[key]), title)}
                        </div>
                      ))}
                    </div>
                </div>
              </div>
            )}

            {/* Fiches vêtement et tenue : globales, elles s'ouvrent par-dessus n'importe quelle page ou popup */}
        {/* ══════════════════ FICHE ARTICLE (détail d'un vêtement) ══════════════════ */}
        {detailItem && (() => {
          const it = detailItem;
          const update = (patch) => setItems((prev) => prev.map((i) => (i.id === it.id ? { ...i, ...(typeof patch === "function" ? patch(i) : patch) } : i)));
          const worn = itemWornDays(it);
          const wornToday = worn.some((d) => new Date(d).toDateString() === new Date().toDateString());
          const withOutfits = outfitsByRecent.filter((o) => (o.itemIds || []).includes(it.id));
          const monthKey = todayKey().slice(0, 7);
          const wornThisMonth = worn.filter((d) => new Date(d).toISOString().slice(0, 7) === monthKey).length;
          const lastWorn = worn.length ? worn.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null;
          const cut = isCutout(it);
          const roundBtn = { width: 40, height: 40, borderRadius: 20, background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
          const chipStyle = (active) => ({ background: active ? COLORS.ink : "transparent", color: active ? "white" : COLORS.ink, border: `1px solid ${active ? COLORS.ink : COLORS.line}` });
          return (
          // La fiche s'ouvre PAR-DESSUS la liste (qui reste en place dessous) : elle démarre toujours en haut,
          // et en la fermant on retrouve la liste exactement là où on l'avait laissée.
          <div className="fixed inset-0 overflow-y-auto" style={{ zIndex: lastFiche === "item" ? 52 : 51, background: COLORS.ivory, overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
            <div className="max-w-3xl mx-auto px-5 pt-10" style={{ paddingBottom: 120 }}>
          <div key={detailItemId} className="slide-right">
            {/* ── Panneau photo, gris clair, arrondi en bas ── */}
            <div className="-mx-5 -mt-10 px-5 pb-5 mb-4" style={{ background: COLORS.haze, borderRadius: "0 0 32px 32px", paddingTop: 44 }}>
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setDetailItemId(null)} aria-label="Retour" style={roundBtn}>
                  <ArrowLeft size={19} />
                </button>
                <div className="flex gap-2 relative">
                  <button type="button" onClick={() => toggleFavoriteItem(it.id)} aria-label={it.favorite ? "Retirer des favoris" : "Ajouter aux favoris"} style={roundBtn}>
                    <Heart size={18} color={COLORS.rose} fill={it.favorite ? COLORS.rose : "none"} />
                  </button>
                  <button type="button" onClick={() => setItemMenuOpen((v) => !v)} aria-label="Plus d'options" style={roundBtn}>
                    <MoreVertical size={18} />
                  </button>
                  {itemMenuOpen && (
                    <div className="absolute right-0 flex flex-col py-1" style={{ top: 48, width: 210, background: "#FFFFFF", borderRadius: 16, boxShadow: "0 10px 30px rgba(0,0,0,0.15)", zIndex: 20 }}>
                      {it.photo && (
                        <button type="button" onClick={() => { setItemMenuOpen(false); detectItemColor(it); }} className="flex items-center gap-2.5 px-4 py-3 text-sm text-left">
                          <Sparkles size={15} /> Détecter les couleurs
                        </button>
                      )}
                      <button type="button" onClick={() => { setItemMenuOpen(false); askConfirm("Supprimer ce vêtement ?", () => removeItem(it.id)); }} className="flex items-center gap-2.5 px-4 py-3 text-sm text-left" style={{ color: COLORS.rose }}>
                        <X size={15} /> Supprimer ce vêtement
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-center py-4">
                {it.photo ? (
                  <img
                    src={it.photo}
                    alt={it.name}
                    style={cut
                      ? { width: "100%", maxWidth: 300, height: 280, objectFit: "contain", display: "block", filter: "drop-shadow(0 8px 14px rgba(0,0,0,0.15))" }
                      : { width: "100%", maxWidth: 300, aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 20, display: "block" }}
                  />
                ) : (
                  <div style={{ width: "100%", maxWidth: 300, aspectRatio: "1 / 1", borderRadius: 20, background: it.hex }} />
                )}
              </div>

              {/* Recadrer et changer la photo, puis le bouton principal : je le porte aujourd'hui */}
              <div className="flex items-center gap-2">
                  {it.photo && (
                    <button
                      type="button"
                      aria-label="Recadrer la photo"
                      style={{ ...roundBtn, width: 50, height: 50, borderRadius: 25 }}
                      onClick={() => {
                        // On repart de la photo complète d'origine si elle existe, pour retrouver toute l'image.
                        setRawImageSrc(it.photoOriginal || it.photo);
                        setCropPosition({ x: 0, y: 0 });
                        setCropZoom(1);
                        setCropTargetItemId(it.id);
                        setShowCropModal(true);
                      }}
                    >
                      <Crop size={18} />
                    </button>
                  )}
                  <label aria-label={it.photo ? "Changer la photo" : "Ajouter une photo"} style={{ ...roundBtn, width: 50, height: 50, borderRadius: 25, cursor: "pointer" }}>
                    <Camera size={18} />
                    <input type="file" accept="image/*" onChange={(e) => handlePhotoChange(e, it.id)} className="hidden" />
                  </label>
              <div className="flex-1 min-w-0">
                {renderWearState({ done: wornToday, onDo: () => wearItemToday(it), onUndo: () => wearItemToday(it), fem: false })}
              </div>
              </div>
            </div>

            {/* Nom (modifiable) */}
            <div className="mb-3">
              {renderEditableTitle(it.name, (v) => update({ name: v }), "Nom du vêtement")}
            </div>

            {/* Onglets */}
            <div className="flex mb-4" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
              {[["apropos", "À propos"], ["tenues", `Tenues${withOutfits.length ? ` · ${withOutfits.length}` : ""}`], ["stats", "Stats"]].map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setDetailTab(k)}
                  className="flex-1 py-2.5 text-sm"
                  style={{ fontWeight: detailTab === k ? 700 : 500, color: detailTab === k ? COLORS.ink : COLORS.muted, borderBottom: `2px solid ${detailTab === k ? COLORS.ink : "transparent"}`, marginBottom: -1 }}
                >
                  {l}
                </button>
              ))}
            </div>

            {/* ── À propos : catégorie, couleurs, météo, occasions, va bien avec, notes ── */}
            {detailTab === "apropos" && (
              <div>
                <div className="flex items-center justify-between py-3" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>Catégorie</span>
                  <select
                    value={it.category}
                    onChange={(e) => update({ category: e.target.value })}
                    className="text-sm rounded-xl px-3"
                    style={{ height: 34, background: COLORS.haze, border: "none", outline: "none" }}
                  >
                    {CATEGORIES.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
                  </select>
                </div>

                <div className="flex items-center justify-between py-3" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                  <span className="flex items-center gap-2" style={{ fontSize: 15, fontWeight: 600 }}>
                    <Scissors size={16} color={COLORS.rose} /> Fait main
                  </span>
                  {renderSwitch(!!it.handmade, () => update((i) => ({ handmade: !i.handmade })), "Fait main")}
                </div>

                <div className="flex items-center justify-between py-3" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                  <span>
                    <span className="block" style={{ fontSize: 15, fontWeight: 600 }}>À motifs</span>
                    <span className="block text-xs" style={{ color: COLORS.muted }}>
                      {typeof it.pattern === "boolean" ? "Réglé par toi" : typeof it.patternScore === "number" ? "Deviné d'après la photo" : "Analyse de la photo en cours…"}
                    </span>
                  </span>
                  {renderSwitch(isPatterned(it), () => update((i) => ({ pattern: !isPatterned(i) })), "À motifs")}
                </div>

                <div className="py-4" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                  <p className="mb-3" style={{ fontSize: 15, fontWeight: 600 }}>Couleurs</p>
                  <div className="flex flex-wrap gap-2">
                    {/* Couleur principale : touche la pastille pour la changer */}
                    <label className="inline-flex items-center gap-2 h-9 pl-1.5 pr-3 rounded-full text-sm cursor-pointer" style={{ background: COLORS.haze }}>
                      <span style={{ width: 24, height: 24, borderRadius: 12, background: it.hex, border: "1px solid rgba(0,0,0,0.08)" }} />
                      {hexToColorName(it.hex)}
                      <input type="color" value={it.hex} onChange={(e) => update({ hex: e.target.value })} className="hidden" />
                    </label>
                    {(it.extraHexes || []).map((hex, idx) => (
                      <span key={idx} className="inline-flex items-center gap-2 h-9 pl-1.5 pr-2 rounded-full text-sm" style={{ background: COLORS.haze }}>
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <span style={{ width: 24, height: 24, borderRadius: 12, background: hex, border: "1px solid rgba(0,0,0,0.08)" }} />
                          {hexToColorName(hex)}
                          <input type="color" value={hex} onChange={(e) => update((i) => ({ extraHexes: (i.extraHexes || []).map((h, k) => (k === idx ? e.target.value : h)) }))} className="hidden" />
                        </label>
                        <button type="button" onClick={() => update((i) => ({ extraHexes: (i.extraHexes || []).filter((_, k) => k !== idx) }))} aria-label="Retirer cette couleur" className="w-6 h-6 flex items-center justify-center">
                          <X size={13} />
                        </button>
                      </span>
                    ))}
                    {(it.extraHexes || []).length < 2 && (
                      <button type="button" onClick={() => update((i) => ({ extraHexes: [...(i.extraHexes || []), "#cccccc"] }))} aria-label="Ajouter une couleur" className="w-9 h-9 rounded-full flex items-center justify-center" style={{ border: `1.5px dashed ${COLORS.line}`, color: COLORS.muted }}>
                        <Plus size={15} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="py-4" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                  <p className="mb-3" style={{ fontSize: 15, fontWeight: 600 }}>Météo</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {WEATHER_TAGS.map((w) => {
                      const active = (it.weather || []).includes(w);
                      return (
                        <button key={w} type="button" onClick={() => update((i) => ({ weather: active ? (i.weather || []).filter((x) => x !== w) : [...(i.weather || []), w] }))} className="px-4 h-9 rounded-full text-sm" style={chipStyle(active)}>
                          {w}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="py-4" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                  <p className="mb-3" style={{ fontSize: 15, fontWeight: 600 }}>Occasions</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {OCCASIONS.map((o) => {
                      const active = (it.occasions || []).includes(o);
                      return (
                        <button key={o} type="button" onClick={() => update((i) => ({ occasions: active ? (i.occasions || []).filter((x) => x !== o) : [...(i.occasions || []), o] }))} className="px-4 h-9 rounded-full text-sm" style={chipStyle(active)}>
                          {o}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="py-4" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                  <div className="flex items-center justify-between mb-3">
                    <p style={{ fontSize: 15, fontWeight: 600 }}>Va bien avec</p>
                    <button type="button" onClick={() => setShowPairsModal(true)} aria-label="Choisir les pièces qui vont bien avec" className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                      <Plus size={15} />
                    </button>
                  </div>
                  {(it.pairsWith || []).length === 0 ? (
                    <p className="text-sm" style={{ color: COLORS.muted }}>Aucune pour l'instant</p>
                  ) : (
                    <div data-no-swipe className="no-scrollbar flex gap-2 overflow-x-auto">
                      {(it.pairsWith || []).map((otherId) => {
                        const other = items.find((i) => i.id === otherId);
                        if (!other) return null;
                        return (
                          <button key={other.id} type="button" onClick={() => setDetailItemId(other.id)} className="flex-shrink-0 overflow-hidden" style={{ width: 64, height: 64, borderRadius: 14, background: other.photo ? COLORS.haze : other.hex }}>
                            {other.photo && <img loading="lazy" decoding="async" src={thumbOf(other)} alt={other.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="py-4">
                  <textarea
                    value={it.notes || ""}
                    onChange={(e) => update({ notes: e.target.value })}
                    placeholder="Notes…"
                    rows={2}
                    className="w-full px-4 py-2.5 rounded-xl text-sm"
                    style={{ background: COLORS.haze, border: "none", outline: "none", resize: "vertical" }}
                  />
                </div>
              </div>
            )}

            {/* ── Tenues : toutes les tenues avec cette pièce ── */}
            {detailTab === "tenues" && (
              <div>
                <div className="flex gap-2 mb-4">
                  <button type="button" onClick={() => { openCreateOutfit(); setSelectedIds([it.id]); }} className="flex-1 h-10 rounded-full text-sm flex items-center justify-center gap-1.5" style={{ background: COLORS.haze, fontWeight: 600 }}>
                    <Plus size={15} /> Créer une tenue avec
                  </button>
                  <button type="button" onClick={() => openWizard(todayKey(), it.id)} className="flex-1 h-10 rounded-full text-sm flex items-center justify-center gap-1.5" style={{ background: COLORS.ink, color: "#FFFFFF", fontWeight: 600 }}>
                    <Sparkles size={15} /> Me suggérer
                  </button>
                </div>
                {withOutfits.length === 0 ? (
                  <p className="text-sm py-8 text-center" style={{ color: COLORS.muted }}>Aucune tenue avec cette pièce pour l'instant</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {withOutfits.map((o) => renderOutfitTile(o, undefined, (outfit) => setDetailOutfitId(outfit.id)))}
                  </div>
                )}
              </div>
            )}

            {/* ── Stats ── */}
            {detailTab === "stats" && (
              <div className="grid grid-cols-2 gap-2">
                {[
                  { n: worn.length, label: worn.length > 1 ? "fois porté" : "fois porté" },
                  { n: wornToday ? "Auj." : lastWorn ? formatDate(lastWorn) : "Jamais", label: "dernière fois", accent: true, small: !wornToday },
                  { n: withOutfits.length, label: withOutfits.length > 1 ? "tenues avec" : "tenue avec" },
                  { n: wornThisMonth, label: "fois ce mois-ci" },
                ].map((st) => (
                  <div key={st.label} style={{ padding: "14px 12px", borderRadius: 16, background: COLORS.haze }}>
                    <p className="display" style={{ fontWeight: 700, fontSize: st.small ? 17 : 24, lineHeight: 1.1, color: st.accent ? COLORS.rose : COLORS.ink }}>{st.n}</p>
                    <p className="text-xs" style={{ marginTop: 6, color: "#777777" }}>{st.label}</p>
                  </div>
                ))}
                <p className="col-span-2 text-xs mt-2" style={{ color: COLORS.muted }}>
                  Dans ta garde-robe depuis le {formatDate(new Date(typeof it.id === "number" && it.id > 1e12 ? it.id : Date.now()).toISOString())}
                </p>
              </div>
            )}

            {/* ── Popup de sélection des associations ── */}
            {showPairsModal && (
              <div
                onClick={() => setShowPairsModal(false)}
                className="fixed inset-0 flex items-end justify-center"
                style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}
              >
                <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md px-5 pt-3 pb-8" style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}><div data-sheet-handle className="flex justify-center -mt-3 pt-3 pb-3" style={{ touchAction: "none", cursor: "grab" }}><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                  <div className="flex items-center justify-between mb-4">
                    <p className="display" style={{ fontWeight: 700, fontSize: 19 }}>Va bien avec</p>
                    <button onClick={() => setShowPairsModal(false)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                      <X size={14} />
                    </button>
                  </div>
                  {renderItemRows({
                    exclude: (i) => i.id === it.id,
                    isSelected: (i) => (it.pairsWith || []).includes(i.id),
                    onPick: (i) => togglePair(it.id, i.id),
                  })}
                </div>
              </div>
            )}
          </div>
            </div>
          </div>
          );
        })()}


            {/* ══════════════════ FICHE TENUE (détail d'une tenue enregistrée) ══════════════════ */}
            {detailOutfitId && (() => {
              const outfit = outfits.find((o) => o.id === detailOutfitId);
              if (!outfit) return null;
              const validated = isWornToday(outfit);
              const pieces = itemsForOutfit(outfit);
              const pal = outfitPalette(outfit);
              const worn = outfitWornDays(outfit);
              const monthKey = todayKey().slice(0, 7);
              const wornThisMonth = worn.filter((d) => new Date(d).toISOString().slice(0, 7) === monthKey).length;
              const lastWorn = worn.length ? worn.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null;
              const updateOutfit = (fn) => setOutfits((prev) => prev.map((o) => (o.id === outfit.id ? { ...o, ...fn(o) } : o)));
              const roundBtn = { width: 40, height: 40, borderRadius: 20, background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
              const chipStyle = (active) => ({ background: active ? COLORS.ink : "transparent", color: active ? "white" : COLORS.ink, border: `1px solid ${active ? COLORS.ink : COLORS.line}` });
              return (
                <div className="fixed inset-0 overflow-y-auto" style={{ zIndex: lastFiche === "outfit" ? 52 : 51, background: COLORS.ivory, overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
                <div className="max-w-3xl mx-auto px-5 pt-10" style={{ paddingBottom: 120 }}>
                <div className="slide-right">
                  {/* ── Panneau : la tenue en flat lay ── */}
                  <div className="-mx-5 -mt-10 px-5 pb-5 mb-4" style={{ background: COLORS.haze, borderRadius: "0 0 32px 32px", paddingTop: 44 }}>
                    <div className="flex items-center justify-between mb-4">
                      <button type="button" onClick={() => setDetailOutfitId(null)} aria-label="Retour aux tenues" style={roundBtn}>
                        <ArrowLeft size={19} />
                      </button>
                      <div className="flex gap-2 relative">
                        <button type="button" onClick={() => toggleFavoriteOutfit(outfit.id)} aria-label={outfit.favorite ? "Retirer des favoris" : "Ajouter aux favoris"} style={roundBtn}>
                          <Heart size={18} color={COLORS.rose} fill={outfit.favorite ? COLORS.rose : "none"} />
                        </button>
                        <button type="button" onClick={() => setOutfitMenuOpen((v) => !v)} aria-label="Plus d'options" style={roundBtn}>
                          <MoreVertical size={18} />
                        </button>
                        {outfitMenuOpen && (
                          <div className="absolute right-0 flex flex-col py-1" style={{ top: 48, width: 210, background: "#FFFFFF", borderRadius: 16, boxShadow: "0 10px 30px rgba(0,0,0,0.15)", zIndex: 20 }}>
                            <button type="button" onClick={() => { setOutfitMenuOpen(false); askConfirm("Supprimer cette tenue ?", () => { removeOutfit(outfit.id); setDetailOutfitId(null); }); }} className="flex items-center gap-2.5 px-4 py-3 text-sm text-left" style={{ color: COLORS.rose }}>
                              <X size={15} /> Supprimer cette tenue
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {pieces.length > 0 ? renderFlatLay(pieces, 300) : (
                      <div className="flex items-center justify-center text-sm" style={{ height: 200, borderRadius: 18, background: "#FFFFFF", color: COLORS.muted }}>Aucune pièce</div>
                    )}

                    {renderWearState({
                      done: validated,
                      onDo: () => { markOutfitWorn(outfit); showToast({ text: "Portée aujourd'hui", sub: "Ajoutée à ta page Aujourd'hui" }); },
                      onUndo: () => { unmarkOutfitWorn(outfit); showToast({ text: "Plus comptée comme portée aujourd'hui" }); },
                      className: "mt-4",
                    })}
                  </div>

                  {/* Nom (modifiable) */}
                  <div className="mb-3">
                    {renderEditableTitle(outfit.name, (v) => updateOutfit(() => ({ name: v })), "Nom de la tenue")}
                  </div>

                  {/* Onglets */}
                  <div className="flex mb-4" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                    {[["apropos", "À propos"], ["pieces", `Pièces · ${pieces.length}`], ["stats", "Stats"]].map(([k, l]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setOutfitTab(k)}
                        className="flex-1 py-2.5 text-sm"
                        style={{ fontWeight: outfitTab === k ? 700 : 500, color: outfitTab === k ? COLORS.ink : COLORS.muted, borderBottom: `2px solid ${outfitTab === k ? COLORS.ink : "transparent"}`, marginBottom: -1 }}
                      >
                        {l}
                      </button>
                    ))}
                  </div>

                  {outfitTab === "apropos" && (
                    <div>
                      {pal.length > 0 && (
                        <div className="py-4" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                          <p className="mb-3" style={{ fontSize: 15, fontWeight: 600 }}>Palette</p>
                          <div className="flex flex-wrap gap-2">
                            {pal.map((hex) => (
                              <span key={hex} className="inline-flex items-center gap-2 h-9 pl-1.5 pr-3 rounded-full text-sm" style={{ background: COLORS.haze }}>
                                <span style={{ width: 24, height: 24, borderRadius: 12, background: hex, border: "1px solid rgba(0,0,0,0.08)" }} />
                                {hexToColorName(hex)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="py-4" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                        <p className="mb-3" style={{ fontSize: 15, fontWeight: 600 }}>Météo</p>
                        <div className="flex gap-1.5 flex-wrap">
                          {WEATHER_TAGS.map((w) => {
                            const active = (outfit.weather || []).includes(w);
                            return (
                              <button key={w} type="button" onClick={() => updateOutfit((o) => ({ weather: active ? (o.weather || []).filter((x) => x !== w) : [...(o.weather || []), w] }))} className="px-4 h-9 rounded-full text-sm" style={chipStyle(active)}>
                                {w}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="py-4">
                        <p className="mb-3" style={{ fontSize: 15, fontWeight: 600 }}>Occasions</p>
                        <div className="flex gap-1.5 flex-wrap">
                          {OCCASIONS.map((o2) => {
                            const active = (outfit.occasions || []).includes(o2);
                            return (
                              <button key={o2} type="button" onClick={() => updateOutfit((o) => ({ occasions: active ? (o.occasions || []).filter((x) => x !== o2) : [...(o.occasions || []), o2] }))} className="px-4 h-9 rounded-full text-sm" style={chipStyle(active)}>
                                {o2}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="py-4">
                        <textarea
                          value={outfit.notes || ""}
                          onChange={(e) => updateOutfit(() => ({ notes: e.target.value }))}
                          placeholder="Notes…"
                          rows={2}
                          className="w-full px-4 py-2.5 rounded-xl text-sm"
                          style={{ background: COLORS.haze, border: "none", outline: "none", resize: "vertical" }}
                        />
                      </div>
                    </div>
                  )}

                  {outfitTab === "pieces" && (
                    <div className="flex flex-col">
                      {pieces.map((item, idx) => (
                        <div key={item.id} className="flex items-center gap-2 py-2.5" style={{ borderBottom: idx < pieces.length - 1 ? `1px solid ${COLORS.line}` : "none" }}>
                          <button
                            type="button"
                            onClick={() => setDetailItemId(item.id)}
                            className="flex-1 min-w-0 flex items-center gap-3 text-left"
                          >
                            <span className="overflow-hidden flex-shrink-0" style={{ width: 56, height: 56, borderRadius: 14, background: item.photo ? COLORS.haze : item.hex }}>
                              {item.photo && <img loading="lazy" decoding="async" src={thumbOf(item)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm truncate" style={{ fontWeight: 600 }}>{item.name}</span>
                              <span className="block text-xs" style={{ color: COLORS.muted }}>{catLabel(item.category)}</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (pieces.length <= 1) { askConfirm("C'est la dernière pièce : supprimer la tenue ?", () => { removeOutfit(outfit.id); setDetailOutfitId(null); }); return; }
                              updateOutfit((o) => ({ itemIds: o.itemIds.filter((id) => id !== item.id) }));
                            }}
                            aria-label={`Retirer ${item.name} de la tenue`}
                            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: COLORS.haze }}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setOutfitPiecePicker(true)}
                        className="mt-3 h-11 rounded-full text-sm flex items-center justify-center gap-1.5"
                        style={{ border: `1.5px dashed ${COLORS.line}`, fontWeight: 600 }}
                      >
                        <Plus size={15} /> Ajouter une pièce
                      </button>

                      {/* Sélecteur : toucher une pièce l'ajoute (ou la retire) de la tenue */}
                      {outfitPiecePicker && (
                        <div onClick={() => setOutfitPiecePicker(false)} className="fixed inset-0 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}>
                          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md px-5 pt-3 pb-8" style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}>
                            <div data-sheet-handle className="flex justify-center -mt-3 pt-3 pb-3" style={{ touchAction: "none", cursor: "grab" }}><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                            <div className="flex items-center justify-between mb-4">
                              <p className="display" style={{ fontWeight: 700, fontSize: 19 }}>Pièces de la tenue</p>
                              <button onClick={() => setOutfitPiecePicker(false)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                                <X size={14} />
                              </button>
                            </div>
                            {renderItemRows({
                              isSelected: (i) => (outfit.itemIds || []).includes(i.id),
                              onPick: (i) => updateOutfit((o) => ({ itemIds: o.itemIds.includes(i.id) ? (o.itemIds.length > 1 ? o.itemIds.filter((id) => id !== i.id) : o.itemIds) : [...o.itemIds, i.id] })),
                            })}
                            <button type="button" onClick={() => setOutfitPiecePicker(false)} className="w-full h-12 rounded-full text-sm font-bold text-white mt-4" style={{ background: COLORS.rose }}>
                              C'est bon
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {outfitTab === "stats" && (
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { n: worn.length, label: "fois portée" },
                        { n: validated ? "Auj." : lastWorn ? formatDate(lastWorn) : "Jamais", label: "dernière fois", accent: true, small: !validated },
                        { n: pieces.length, label: pieces.length > 1 ? "pièces" : "pièce" },
                        { n: wornThisMonth, label: "fois ce mois-ci" },
                      ].map((st) => (
                        <div key={st.label} style={{ padding: "14px 12px", borderRadius: 16, background: COLORS.haze }}>
                          <p className="display" style={{ fontWeight: 700, fontSize: st.small ? 17 : 24, lineHeight: 1.1, color: st.accent ? COLORS.rose : COLORS.ink }}>{st.n}</p>
                          <p className="text-xs" style={{ marginTop: 6, color: "#777777" }}>{st.label}</p>
                        </div>
                      ))}
                      <p className="col-span-2 text-xs mt-2" style={{ color: COLORS.muted }}>
                        Créée le {formatDate(new Date(typeof outfit.id === "number" && outfit.id > 1e12 ? outfit.id : Date.now()).toISOString())}
                      </p>
                    </div>
                  )}
                </div>
                </div>
                </div>
              );
            })()}

            {/* ── Pièces d'une tenue prévue : ajouter (ex. des chaussures oubliées) ou retirer, pour ce jour seulement ── */}
            {entryPicker && (() => {
              const e = normalizeDayEntries(agenda[entryPicker.dateStr]).find((x) => x.id === entryPicker.entryId);
              if (!e) return null;
              return (
                <div onClick={() => setEntryPicker(null)} className="fixed inset-0 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.4)", zIndex: 55 }}>
                  <div onClick={(ev) => ev.stopPropagation()} className="w-full max-w-md px-5 pt-3 pb-8" style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}>
                    <div data-sheet-handle className="flex justify-center -mt-3 pt-3 pb-3" style={{ touchAction: "none", cursor: "grab" }}><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="display" style={{ fontWeight: 700, fontSize: 19 }}>{e.label}</p>
                      <button onClick={() => setEntryPicker(null)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                        <X size={14} />
                      </button>
                    </div>
                    <p className="text-xs mb-4" style={{ color: COLORS.muted }}>
                      {e.outfitId ? "Pour ce jour seulement : ta tenue enregistrée ne change pas." : "Touche une pièce pour l'ajouter ou la retirer."}
                    </p>
                    {renderItemRows({
                      isSelected: (i) => e.itemIds.includes(i.id),
                      onPick: (i) => (e.itemIds.includes(i.id) ? (e.itemIds.length > 1 && removeItemFromEntry(e.dateStr || entryPicker.dateStr, e.id, i.id)) : addItemToEntry(entryPicker.dateStr, e.id, i.id)),
                    })}
                    <button type="button" onClick={() => setEntryPicker(null)} className="w-full h-12 rounded-full text-sm font-bold text-white mt-4" style={{ background: COLORS.rose }}>
                      C'est bon
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* ── Popup synchro ── */}
            {showSyncSheet && (
              <div
                onClick={() => !syncSetup.busy && setShowSyncSheet(false)}
                className="fixed inset-0 flex items-end justify-center"
                style={{ background: "rgba(0,0,0,0.4)", zIndex: 55 }}
              >
                <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md px-5 pt-3 pb-8" style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}>
                  <div data-sheet-handle className="flex justify-center -mt-3 pt-3 pb-3" style={{ touchAction: "none", cursor: "grab" }}><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="display" style={{ fontWeight: 700, fontSize: 19 }}>Synchro</p>
                    <button onClick={() => setShowSyncSheet(false)} disabled={syncSetup.busy} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                      <X size={14} />
                    </button>
                  </div>

                  {syncSetup.step === "code" && (
                    <>
                      <p className="text-sm mb-4" style={{ color: "#555555", lineHeight: 1.5 }}>
                        Choisis un code secret (8 caractères minimum) et tape le <b>même</b> sur ton téléphone et ton ordi. Tes vêtements, tenues et agenda seront les mêmes partout. Garde-le bien : c'est la clé de tes données.
                      </p>
                      <input
                        type="text"
                        value={syncSetup.code}
                        onChange={(e) => setSyncSetup((st) => ({ ...st, code: e.target.value, error: "" }))}
                        placeholder="ex. armoire-de-lucie-2026"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        className="w-full px-4 py-3 rounded-xl text-sm mb-3"
                        style={{ border: `1px solid ${COLORS.line}` }}
                      />
                      {syncSetup.error && <p className="text-xs mb-3" style={{ color: COLORS.rose }}>{syncSetup.error}</p>}
                      <button
                        type="button"
                        onClick={startSyncSetup}
                        disabled={syncSetup.busy}
                        className="w-full rounded-full text-sm"
                        style={{ height: 44, background: COLORS.ink, color: "#FFFFFF", fontWeight: 600, opacity: syncSetup.busy ? 0.6 : 1 }}
                      >
                        {syncSetup.busy ? "Vérification…" : "Activer la synchro"}
                      </button>
                    </>
                  )}

                  {syncSetup.step === "choose" && syncSetup.remote && (
                    <>
                      <p className="text-sm mb-4" style={{ color: "#555555", lineHeight: 1.5 }}>
                        Il y a déjà des données en ligne pour ce code, et d'autres sur cet appareil. Lesquelles garder ? Les autres seront remplacées.
                      </p>
                      <button
                        type="button"
                        onClick={() => finishSyncSetup("remote")}
                        disabled={syncSetup.busy}
                        className="w-full text-left p-4 rounded-2xl mb-2"
                        style={{ background: COLORS.haze }}
                      >
                        <p className="text-sm" style={{ fontWeight: 700 }}>Celles en ligne</p>
                        <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
                          {syncSetup.remote.data.items.length} vêtements · {(syncSetup.remote.data.outfits || []).length} tenues · modifiées {formatSyncTime(syncSetup.remote.updated_at)}
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => finishSyncSetup("local")}
                        disabled={syncSetup.busy}
                        className="w-full text-left p-4 rounded-2xl mb-3"
                        style={{ background: COLORS.haze }}
                      >
                        <p className="text-sm" style={{ fontWeight: 700 }}>Celles de cet appareil</p>
                        <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>
                          {items.length} vêtements · {outfits.length} tenues
                        </p>
                      </button>
                      {syncSetup.error && <p className="text-xs" style={{ color: COLORS.rose }}>{syncSetup.error}</p>}
                    </>
                  )}

                  {syncSetup.step === "done" && (
                    <>
                      <p className="text-sm mb-4" style={{ color: "#555555", lineHeight: 1.5 }}>
                        Synchro activée. Chaque changement part en ligne automatiquement. Tape le même code sur ton autre appareil.
                      </p>
                      <button type="button" onClick={() => setShowSyncSheet(false)} className="w-full rounded-full text-sm" style={{ height: 44, background: COLORS.ink, color: "#FFFFFF", fontWeight: 600 }}>
                        Super
                      </button>
                    </>
                  )}

                  {syncSetup.step === "info" && (
                    <>
                      <p className="text-sm mb-1" style={{ fontWeight: 600 }}>
                        {syncStatus === "ok" && `Tout est enregistré en ligne (${formatSyncTime(syncedAt)})`}
                        {(syncStatus === "pending" || syncStatus === "saving") && "Enregistrement en ligne en cours…"}
                        {syncStatus === "offline" && "Pas de réseau pour l'instant"}
                        {syncStatus === "error" && "La synchro n'a pas pu se faire"}
                      </p>
                      <p className="text-sm mb-4" style={{ color: "#555555", lineHeight: 1.5 }}>
                        {syncStatus === "ok"
                          ? "Tes changements partent en ligne automatiquement."
                          : "Rien n'est perdu : tout est gardé sur cet appareil et partira en ligne dès que possible."}
                      </p>
                      <button
                        type="button"
                        onClick={() => { pullNow(); }}
                        className="w-full rounded-full text-sm mb-3"
                        style={{ height: 44, background: COLORS.ink, color: "#FFFFFF", fontWeight: 600 }}
                      >
                        Synchroniser maintenant
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (window.confirm("Arrêter la synchro sur cet appareil ? Tes données restent ici et en ligne.")) { disableSync(); setShowSyncSheet(false); } }}
                        className="w-full text-center text-xs"
                        style={{ color: COLORS.muted }}
                      >
                        Arrêter la synchro sur cet appareil
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── Popup de confirmation avant suppression — globale ── */}
            {confirmDialog && (
              <div
                onClick={() => setConfirmDialog(null)}
                className="fixed inset-0 flex items-center justify-center p-5"
                style={{ background: "rgba(0,0,0,0.4)", zIndex: 60 }}
              >
                <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xs rounded-2xl p-5 text-center" style={{ background: "#FFFFFF" }}>
                  <div className="w-11 h-11 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: "#FDE8E5" }}>
                    <X size={18} color={COLORS.rose} />
                  </div>
                  <p className="display mb-5" style={{ fontWeight: 700, fontSize: 17 }}>{confirmDialog.message}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDialog(null)}
                      className="flex-1 px-5 h-12 rounded-full text-sm font-bold"
                      style={{ border: `1px solid ${COLORS.line}`, color: COLORS.ink }}
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
                      className="flex-1 px-5 h-12 rounded-full text-sm font-bold text-white"
                      style={{ background: COLORS.rose }}
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Popup du générateur, en étapes — globale, accessible depuis n'importe quel onglet ── */}
            {showWizard && (() => {
              const step = WIZARD_STEPS[wizardStep];
              const isFirst = wizardStep === 0;
              const isLast = wizardStep === WIZARD_STEPS.length - 1;
              return (
                <div
                  onClick={() => setShowWizard(false)}
                  className="fixed inset-0 flex items-end justify-center"
                  style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}
                >
                  <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md px-5 pt-3 pb-8" style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}><div data-sheet-handle className="flex justify-center -mt-3 pt-3 pb-3" style={{ touchAction: "none", cursor: "grab" }}><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="display" style={{ fontWeight: 700, fontSize: 19 }}>Me suggérer</p>
                      <button onClick={() => setShowWizard(false)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                        <X size={14} />
                      </button>
                    </div>
                    {!wizardGenerating && !wizardShowResult ? (
                      <div className="flex gap-1.5 mb-4" aria-label={`Étape ${wizardStep + 1} sur ${WIZARD_STEPS.length}`}>
                        {WIZARD_STEPS.map((st, idx) => (
                          <span key={st} style={{ width: idx === wizardStep ? 18 : 6, height: 6, borderRadius: 3, background: idx <= wizardStep ? COLORS.rose : COLORS.line, transition: "width 0.2s" }} />
                        ))}
                      </div>
                    ) : (
                      <div className="mb-4" />
                    )}

                    {/* ── Écran de chargement ── */}
                    {wizardGenerating && (
                      <div className="py-10 flex flex-col items-center justify-center">
                        <Sparkles size={28} color={COLORS.rose} className="wizard-spin" />
                      </div>
                    )}

                    {/* ── Écran de résultat : la tenue générée, prête à enregistrer ── */}
                    {/* ── Choix d'une pièce : remplacer (même catégorie) ou ajouter ── */}
                    {!wizardGenerating && wizardShowResult && wizardSwap !== null && (() => {
                      const current = wizardSwap === "add" ? null : items.find((i) => i.id === selectedIds[wizardSwap]);
                      const category = current ? current.category : null;
                      const candidates = items
                        .filter((i) => !selectedIds.includes(i.id))
                        .filter((i) => (category ? i.category === category : wizardAddFilter === "Tous" || i.category === wizardAddFilter))
                        .sort(compareByColor);
                      return (
                        <div className="mb-4">
                          <div className="flex items-center justify-between mb-3">
                            <button type="button" onClick={() => setWizardSwap(null)} aria-label="Retour à la tenue" className="w-9 h-9 -ml-2 rounded-full flex items-center justify-center">
                              <ArrowLeft size={18} />
                            </button>
                            <p className="display" style={{ fontWeight: 700, fontSize: 16 }}>
                              {category ? CATEGORY_PLURALS[category] || category : "Ajouter une pièce"}
                            </p>
                            <span className="w-9" />
                          </div>

                          {!category && (
                            <div data-no-swipe className="no-scrollbar flex gap-2 overflow-x-auto mb-3">
                              {["Tous", ...CATEGORIES].map((c) => {
                                const active = wizardAddFilter === c;
                                return (
                                  <button
                                    key={c}
                                    type="button"
                                    onClick={() => setWizardAddFilter(c)}
                                    className="flex-shrink-0 px-3 rounded-full text-xs"
                                    style={{ height: 32, background: active ? COLORS.ink : "transparent", color: active ? "white" : COLORS.ink, border: `1px solid ${active ? COLORS.ink : COLORS.line}` }}
                                  >
                                    {c === "Tous" ? "Tout" : CATEGORY_PLURALS[c] || c}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {candidates.length === 0 ? (
                            <p className="text-sm py-6 text-center" style={{ color: COLORS.muted }}>Aucune autre pièce</p>
                          ) : (
                            <div className="grid grid-cols-3 gap-2 mb-3">
                              {candidates.map((item) => (
                                <button key={item.id} type="button" onClick={() => pickWizardItem(item.id)} aria-label={item.name} className="rounded-xl overflow-hidden" style={{ background: COLORS.haze }}>
                                  {item.photo ? (
                                    <img src={thumbOf(item)} alt={item.name} loading="lazy" decoding="async" style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
                                  ) : (
                                    <div style={{ background: item.hex, aspectRatio: "1 / 1" }} />
                                  )}
                                </button>
                              ))}
                            </div>
                          )}

                          {current && (
                            <button type="button" onClick={() => removeWizardItem(wizardSwap)} className="w-full px-5 h-12 rounded-full text-sm font-bold" style={{ border: `1px solid ${COLORS.rose}`, color: COLORS.rose }}>
                              Retirer cette pièce
                            </button>
                          )}
                        </div>
                      );
                    })()}

                    {!wizardGenerating && wizardShowResult && wizardSwap === null && (
                      <div className="mb-4">
                        {wizardFromOutfitId && (() => {
                          const o = outfits.find((x) => x.id === wizardFromOutfitId);
                          const n = o ? outfitWornDays(o).length : 0;
                          return (
                            <p className="text-xs mb-3 px-3 py-2 rounded-full inline-flex items-center gap-1.5" style={{ background: "#FDE8E5", color: COLORS.ink }}>
                              <Heart size={12} color={COLORS.rose} fill={COLORS.rose} />
                              Une de tes tenues{o ? ` · ${o.name}` : ""}{n > 0 ? ` · portée ${n} fois` : ""}
                            </p>
                          );
                        })()}
                        <div className="grid grid-cols-3 gap-2 mb-4">
                          {selectedIds.map((id, index) => {
                            const item = items.find((i) => i.id === id);
                            if (!item) return null;
                            return (
                              <div key={item.id} className="relative">
                                <button
                                  type="button"
                                  onClick={() => setWizardSwap(index)}
                                  aria-label={`Changer : ${item.name}`}
                                  className="w-full rounded-xl overflow-hidden block"
                                  style={{ background: COLORS.haze }}
                                >
                                  {item.photo ? (
                                    <img loading="lazy" decoding="async" src={thumbOf(item)} alt={item.name} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
                                  ) : (
                                    <div style={{ background: item.hex, aspectRatio: "1 / 1" }} />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeWizardItem(index)}
                                  aria-label={`Retirer : ${item.name}`}
                                  className="absolute w-6 h-6 rounded-full flex items-center justify-center"
                                  style={{ top: 5, right: 5, background: "rgba(255,255,255,0.9)", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => { setWizardAddFilter("Tous"); setWizardSwap("add"); }}
                            aria-label="Ajouter une pièce"
                            className="rounded-xl flex items-center justify-center"
                            style={{ aspectRatio: "1 / 1", border: `1.5px dashed ${COLORS.line}`, color: COLORS.muted }}
                          >
                            <Plus size={22} />
                          </button>
                        </div>

                        {!wizardFromOutfitId && (
                          <input
                            value={outfitName}
                            onChange={(e) => setOutfitName(e.target.value)}
                            placeholder="Nom de la tenue"
                            className="w-full px-4 py-2.5 rounded-xl text-sm mb-3"
                            style={{ border: `1px solid ${COLORS.line}`, outline: "none" }}
                          />
                        )}

                        {!wizardTargetDate && !wizardFromOutfitId && renderOutfitTagPicker()}

                        {!wizardTargetDate && !wizardFromOutfitId && (() => {
                          const m = findSimilarOutfit(selectedIds);
                          if (!m || m.exact) return null;
                          return renderOutfitDupPanel(m, { onView: () => { setShowWizard(false); changeView("tenues"); setDetailOutfitId(m.outfit.id); } });
                        })()}

                        <div className="flex gap-2">
                          <button onClick={wizardGenerate} className="flex items-center gap-1.5 px-5 h-12 rounded-full text-sm font-bold" style={{ border: `1px solid ${COLORS.line}`, color: COLORS.ink }}>
                            <Sparkles size={14} /> Régénérer
                          </button>
                          <button
                            onClick={() => wizardSaveOutfit()}
                            disabled={selectedIds.length === 0 || (!wizardTargetDate && !outfitName.trim())}
                            className="flex-1 px-5 h-12 rounded-full text-sm font-bold text-white"
                            style={{ background: COLORS.rose, opacity: (selectedIds.length === 0 || (!wizardTargetDate && !outfitName.trim())) ? 0.4 : 1 }}
                          >
                            {wizardTargetDate ? `Planifier pour ${wizardTargetDate === todayKey() ? "aujourd'hui" : "demain"}` : wizardFromOutfitId ? "Voir la tenue" : "Ajouter à mes tenues"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ── Questions, une étape à la fois ── */}
                    {!wizardGenerating && !wizardShowResult && (
                      <>
                    {step === "piece" && wizardLocalWeather && (
                      <div className="flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-2xl" style={{ background: COLORS.haze }}>
                        <p className="text-xs flex items-center gap-1.5 min-w-0" style={{ opacity: wizardUseLocalWeather ? 1 : 0.5 }}>
                          <Sun size={13} className="flex-shrink-0" />
                          <span className="truncate">
                            {wizardUseLocalWeather
                              ? `${wizardTargetDate === tomorrowKey() ? "Demain · " : ""}${weatherToTag(wizardLocalWeather)} · ${wizardLocalWeather.min}° / ${wizardLocalWeather.max}°${wizardLocalWeather.rainChance != null && wizardLocalWeather.rainChance >= 30 ? ` · pluie ${wizardLocalWeather.rainChance} %` : ""}`
                              : "Météo d'ici non prise en compte"}
                          </span>
                        </p>
                        {/* Interrupteur : météo automatique oui / non */}
                        <button
                          type="button"
                          role="switch"
                          aria-checked={wizardUseLocalWeather}
                          aria-label="Utiliser la météo d'ici"
                          onClick={toggleWizardLocalWeather}
                          className="flex-shrink-0 relative"
                          style={{ width: 40, height: 24, borderRadius: 12, background: wizardUseLocalWeather ? COLORS.ink : "#D6D4D0", transition: "background 0.2s" }}
                        >
                          <span style={{ position: "absolute", top: 3, left: wizardUseLocalWeather ? 19 : 3, width: 18, height: 18, borderRadius: 9, background: "#FFFFFF", transition: "left 0.2s" }} />
                        </button>
                      </div>
                    )}
                    {step === "piece" && (
                      <div className="mb-4">
                        <p className="text-sm font-medium mb-3">Une pièce en tête ?</p>
                        {/* Pièce choisie : rappel en haut, avec de quoi la retirer */}
                        {wizardBaseItemId && (() => {
                          const chosen = items.find((i) => i.id === wizardBaseItemId);
                          if (!chosen) return null;
                          return (
                            <div className="flex items-center gap-3 p-2 pr-3 mb-3 rounded-2xl" style={{ background: "#FDE8E5" }}>
                              <div className="overflow-hidden flex-shrink-0" style={{ width: 48, height: 48, borderRadius: 10, background: chosen.hex }}>
                                {chosen.photo && <img src={thumbOf(chosen)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                              </div>
                              <p className="flex-1 text-sm truncate" style={{ fontWeight: 600 }}>{chosen.name}</p>
                              <button type="button" onClick={() => setWizardBaseItemId(null)} aria-label="Retirer la pièce en tête" className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#FFFFFF" }}>
                                <X size={14} />
                              </button>
                            </div>
                          );
                        })()}

                        {!wizardPieceCat ? (
                          /* 1. D'abord les catégories, avec un aperçu de leurs couleurs */
                          <div className="grid grid-cols-2 gap-2">
                            {CATEGORIES.map((cat) => {
                              const catItems = sortItems(items.filter((i) => i.category === cat), "couleur");
                              if (catItems.length === 0) return null;
                              const dots = [...new Set(catItems.map((i) => (i.hex || "").toLowerCase()).filter(Boolean))].slice(0, 4);
                              return (
                                <button
                                  type="button"
                                  key={cat}
                                  onClick={() => setWizardPieceCat(cat)}
                                  className="flex flex-col items-start gap-2 p-3 rounded-2xl text-left"
                                  style={{ background: COLORS.haze }}
                                >
                                  <span className="flex" style={{ paddingLeft: 5 }}>
                                    {dots.map((hex) => (
                                      <span key={hex} style={{ width: 16, height: 16, borderRadius: 8, background: hex, border: "1px solid rgba(0,0,0,0.1)", marginLeft: -5, boxShadow: `0 0 0 2px ${COLORS.haze}` }} />
                                    ))}
                                  </span>
                                  <span className="text-sm" style={{ fontWeight: 600 }}>
                                    {CATEGORY_PLURALS[cat] || cat} <span style={{ fontWeight: 400, color: COLORS.muted }}>· {catItems.length}</span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          /* 2. Puis les pièces de la catégorie choisie seulement */
                          <div>
                            <div className="flex items-center gap-1 mb-2">
                              <button type="button" onClick={() => setWizardPieceCat(null)} aria-label="Retour aux catégories" className="w-9 h-9 -ml-2 rounded-full flex items-center justify-center">
                                <ArrowLeft size={18} />
                              </button>
                              <p className="text-sm" style={{ fontWeight: 600 }}>{CATEGORY_PLURALS[wizardPieceCat] || wizardPieceCat}</p>
                            </div>
                            <div className="grid grid-cols-4 gap-2">
                              {sortItems(items.filter((i) => i.category === wizardPieceCat), "couleur").map((item) => {
                                const active = wizardBaseItemId === item.id;
                                return (
                                  <button
                                    type="button"
                                    key={item.id}
                                    onClick={() => { setWizardBaseItemId(active ? null : item.id); setWizardPieceCat(null); }}
                                    aria-label={item.name}
                                    aria-pressed={active}
                                    className="relative overflow-hidden"
                                    style={{ aspectRatio: "1 / 1", borderRadius: 12, background: COLORS.haze, boxShadow: active ? `0 0 0 2px ${COLORS.rose}` : "none" }}
                                  >
                                    {item.photo ? (
                                      <img src={thumbOf(item)} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                                    ) : (
                                      <div style={{ background: item.hex, width: "100%", height: "100%" }} />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {step === "meteo" && (
                      <div className="mb-4">
                        <p className="text-sm font-medium mb-3">Il fait quel temps aujourd'hui ?</p>
                        <div className="flex gap-1.5 flex-wrap">
                          {WEATHER_TAGS.map((w) => {
                            const active = currentWeather === w;
                            return (
                              <button type="button" key={w} onClick={() => setCurrentWeather(active ? null : w)} className="px-4 h-9 rounded-full text-sm" style={{
                                background: active ? COLORS.ink : "transparent",
                                color: active ? "white" : COLORS.ink,
                                border: `1px solid ${active ? COLORS.ink : COLORS.line}`,
                              }}>
                                {w}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {step === "occasion" && (
                      <div className="mb-4">
                        <p className="text-sm font-medium mb-3">Pour quelle occasion ?</p>
                        <div className="flex gap-1.5 flex-wrap">
                          {OCCASIONS.map((o) => {
                            const active = genOccasion === o;
                            return (
                              <button type="button" key={o} onClick={() => setGenOccasion(active ? null : o)} className="px-4 h-9 rounded-full text-sm" style={{
                                background: active ? COLORS.ink : "transparent",
                                color: active ? "white" : COLORS.ink,
                                border: `1px solid ${active ? COLORS.ink : COLORS.line}`,
                              }}>
                                {o}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {step === "couleur" && (
                      <div className="mb-4">
                        <p className="text-sm font-medium mb-3">Quelles couleurs ?</p>
                        <div className="flex gap-1.5 flex-wrap">
                          {COLOR_FAMILIES.map((c) => {
                            const active = genColorFamily === c;
                            // Nombre de vêtements de cette famille ; famille vide = grisée, non choisissable.
                            const count = items.filter((i) => itemHasFamily(i, c)).length;
                            const empty = count === 0;
                            return (
                              <button
                                type="button"
                                key={c}
                                disabled={empty}
                                onClick={() => setGenColorFamily(active ? null : c)}
                                className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm"
                                style={{
                                  background: active ? COLORS.ink : "transparent",
                                  color: active ? "white" : empty ? "#B5B5B5" : COLORS.ink,
                                  border: active ? `1px solid ${COLORS.ink}` : empty ? "1px dashed #DDDDDD" : `1px solid ${COLORS.line}`,
                                }}
                              >
                                {c}
                                <span className="text-xs" style={{ color: active ? "rgba(255,255,255,0.7)" : empty ? "#B5B5B5" : COLORS.muted }}>· {count}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {step === "preference" && (
                      <div className="mb-4">
                        <p className="text-sm font-medium mb-3">Des habitués, ou on ose du neuf ?</p>
                        <div className="flex gap-1.5 flex-wrap">
                          {[{ key: "souvent", label: "Vêtements souvent portés" }, { key: "oser", label: "Oser du neuf" }].map(({ key, label }) => {
                            const active = genPreference === key;
                            return (
                              <button type="button" key={key} onClick={() => setGenPreference(active ? null : key)} className="px-4 h-9 rounded-full text-sm" style={{
                                background: active ? COLORS.ink : "transparent",
                                color: active ? "white" : COLORS.ink,
                                border: `1px solid ${active ? COLORS.ink : COLORS.line}`,
                              }}>
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      {!isFirst && (
                        <button onClick={wizardBack} className="flex items-center gap-1 px-5 h-12 rounded-full text-sm font-bold" style={{ border: `1px solid ${COLORS.line}`, color: COLORS.ink }}>
                          <ArrowLeft size={14} /> Précédent
                        </button>
                      )}
                      {!isLast ? (
                        <button onClick={wizardNext} className="flex-1 px-5 h-12 rounded-full text-sm font-bold text-white" style={{ background: COLORS.rose }}>
                          Suivant
                        </button>
                      ) : (
                        <button onClick={wizardGenerate} className="flex-1 flex items-center justify-center gap-1.5 px-5 h-12 rounded-full text-sm font-bold text-white" style={{ background: COLORS.rose }}>
                          <Sparkles size={14} /> Générer la tenue
                        </button>
                      )}
                    </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })()}
            {/* ── Popup de recadrage de photo — globale, accessible depuis n'importe quel onglet ── */}
            {showCropModal && (
              <div
                className="fixed inset-0 flex items-end justify-center"
                style={{ background: "rgba(0,0,0,0.6)", zIndex: 60 }}
              >
                <div className="w-full max-w-md px-5 pt-3 pb-8" style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0" }}><div data-sheet-handle className="flex justify-center -mt-3 pt-3 pb-3" style={{ touchAction: "none", cursor: "grab" }}><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                  <div className="flex items-center justify-between mb-4">
                    <p className="display" style={{ fontWeight: 700, fontSize: 19 }}>Recadrer la photo</p>
                    <button onClick={() => { setShowCropModal(false); setRawImageSrc(null); }} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                      <X size={14} />
                    </button>
                  </div>

                  {/* Le recadreur a besoin d'un conteneur avec une hauteur fixe et position relative */}
                  <div style={{ position: "relative", width: "100%", height: 280, background: cropInfo && cropInfo.transparent ? COLORS.haze : "#222", borderRadius: 8, overflow: "hidden" }}>
                    {rawImageSrc && (
                      <Cropper
                        image={rawImageSrc}
                        crop={cropPosition}
                        zoom={cropZoom}
                        aspect={1}
                        onCropChange={setCropPosition}
                        onZoomChange={setCropZoom}
                        onCropComplete={(_, areaPixels) => setCroppedAreaPixels(areaPixels)}
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-3 mt-4 mb-4">
                    <Search size={14} style={{ opacity: 0.4 }} />
                    <input
                      type="range"
                      min={1}
                      max={3}
                      step={0.01}
                      value={cropZoom}
                      onChange={(e) => setCropZoom(Number(e.target.value))}
                      className="flex-1"
                    />
                  </div>

                  <button
                    onClick={confirmCrop}
                    disabled={uploadingPhoto}
                    className="w-full flex items-center justify-center gap-1.5 px-5 h-12 rounded-full text-sm font-bold text-white"
                    style={{ background: COLORS.rose, opacity: uploadingPhoto ? 0.6 : 1 }}
                  >
                    {uploadingPhoto ? "Envoi en cours..." : "Valider le recadrage"}
                  </button>
                </div>
              </div>
            )}

            {/* ── Popup de sélection rapide — globale, accessible depuis n'importe quel onglet ── */}
            {showQuickPlanModal && (
              <div
                onClick={() => setShowQuickPlanModal(false)}
                className="fixed inset-0 flex items-end justify-center"
                style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}
              >
                <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md px-5 pt-3 pb-8" style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}><div data-sheet-handle className="flex justify-center -mt-3 pt-3 pb-3" style={{ touchAction: "none", cursor: "grab" }}><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      {quickPlanMode !== "choice" && (
                        <button onClick={() => setQuickPlanMode("choice")} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                          <ArrowLeft size={14} />
                        </button>
                      )}
                      <p className="display" style={{ fontWeight: 700, fontSize: 19 }}>
                        {planDate === todayKey() ? "Tenue pour aujourd'hui" : planDate === tomorrowKey() ? "Tenue pour demain" : "Planifier une tenue"}
                      </p>
                    </div>
                    <button onClick={() => setShowQuickPlanModal(false)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                      <X size={14} />
                    </button>
                  </div>

                  {quickPlanMode === "choice" && (
                    <div className="mb-3">
                      <label className="block text-xs mb-1" style={{ opacity: 0.6 }}>Date</label>
                      <input
                        type="date"
                        value={planDate}
                        onChange={(e) => setPlanDate(e.target.value)}
                        className="px-4 py-2.5 rounded-xl text-sm"
                        style={{ border: `1px solid ${COLORS.line}` }}
                      />
                    </div>
                  )}

                  {/* Étape 1 : comment veux-tu procéder ? */}
                  {quickPlanMode === "choice" && (() => {
                    // Tenues adaptées à la météo du jour planifié (aujourd'hui ou demain), à planifier en un geste.
                    const dayW = planDate === todayKey() ? weather : planDate === tomorrowKey() && weather ? weather.tomorrow : null;
                    const dayTag = weatherToTag(dayW);
                    const picks = dayTag ? outfitsByRecent.filter((o) => (o.weather || []).includes(dayTag)) : [];
                    if (picks.length === 0) return null;
                    return (
                      <div className="mb-4">
                        <p className="display" style={{ fontWeight: 700, fontSize: 15 }}>
                          Parfaites pour {planDate === todayKey() ? "aujourd'hui" : "demain"}
                        </p>
                        <p className="text-xs mb-2" style={{ color: COLORS.muted }}>{dayTag} · {dayW.min}° / {dayW.max}° · touche une tenue pour la planifier</p>
                        <div data-no-swipe className="no-scrollbar -mx-5 px-5 py-0.5 flex gap-2.5 overflow-x-auto">
                          {picks.map((o) =>
                            renderOutfitTile(o, 96, (outfit) => {
                              planItemsOnDate(planDate, outfit.itemIds, outfit.name, outfit.id);
                              setShowQuickPlanModal(false);
                            })
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  {quickPlanMode === "choice" && (
                    <div className="space-y-2">
                      <button
                        onClick={() => setQuickPlanMode("existing")}
                        disabled={outfits.length === 0}
                        className="w-full text-left p-3 rounded-lg text-sm"
                        style={{ border: `1px solid ${COLORS.line}`, opacity: outfits.length === 0 ? 0.4 : 1 }}
                      >
                        <p className="font-medium">Une de mes tenues</p>
                      </button>
                      <button onClick={() => setQuickPlanMode("create")} className="w-full text-left p-3 rounded-lg text-sm" style={{ border: `1px solid ${COLORS.line}` }}>
                        <p className="font-medium">Créer une tenue</p>
                      </button>
                      <button
                        onClick={() => { setShowQuickPlanModal(false); openWizard(planDate); }}
                        className="w-full text-left p-3 rounded-lg text-sm"
                        style={{ border: `1px solid ${COLORS.gold}` }}
                      >
                        <p className="font-medium flex items-center gap-1.5" style={{ color: COLORS.gold }}><Sparkles size={14} /> Générer une tenue</p>
                      </button>
                    </div>
                  )}

                  {/* Étape 2a : piocher parmi les tenues déjà enregistrées */}
                  {quickPlanMode === "existing" && (
                    <div>
                      <div className="flex gap-1.5 flex-wrap mb-3">
                        <select
                          value={outfitWeatherFilter}
                          onChange={(e) => setOutfitWeatherFilter(e.target.value)}
                          className="px-2.5 py-1 rounded-full text-[11px]"
                          style={{ border: `1px solid ${COLORS.line}`, background: COLORS.card }}
                        >
                          <option value="Tous">Toute météo</option>
                          {WEATHER_TAGS.map((w) => <option key={w} value={w}>{w}</option>)}
                        </select>
                        <select
                          value={outfitOccasionFilter}
                          onChange={(e) => setOutfitOccasionFilter(e.target.value)}
                          className="px-2.5 py-1 rounded-full text-[11px]"
                          style={{ border: `1px solid ${COLORS.line}`, background: COLORS.card }}
                        >
                          <option value="Tous">Toutes occasions</option>
                          {OCCASIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>

                      <div className="space-y-2">
                        {outfits
                          .filter((o) => outfitWeatherFilter === "Tous" || (o.weather || []).includes(outfitWeatherFilter))
                          .filter((o) => outfitOccasionFilter === "Tous" || (o.occasions || []).includes(outfitOccasionFilter))
                          .map((outfit) => (
                          <button
                            key={outfit.id}
                            onClick={() => {
                              planItemsOnDate(planDate, outfit.itemIds, outfit.name, outfit.id);
                              setShowQuickPlanModal(false);
                            }}
                            className="w-full text-left p-3 rounded-lg flex items-center gap-3"
                            style={{ border: `1px solid ${COLORS.line}` }}
                          >
                            <div className="flex gap-1">
                              {itemsForOutfit(outfit).slice(0, 3).map((item) => (
                                <div key={item.id} className="rounded overflow-hidden" style={{ background: item.hex, width: 28, height: 28, border: `1px solid ${COLORS.line}` }}>
                                  {item.photo && <img loading="lazy" decoding="async" src={thumbOf(item)} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                                </div>
                              ))}
                            </div>
                            <p className="text-sm font-medium">{outfit.name}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Étape 2b : sélection manuelle des vêtements */}
                  {quickPlanMode === "create" && (
                    <>
                      <input
                        value={planLabel}
                        onChange={(e) => setPlanLabel(e.target.value)}
                        placeholder="Nom (optionnel)"
                        className="w-full px-4 py-2.5 rounded-xl text-sm mb-3"
                        style={{ border: `1px solid ${COLORS.line}`, outline: "none" }}
                      />

                      <div className="mb-4">
                        {renderItemRows({
                          isSelected: (item) => planItemIds.includes(item.id),
                          onPick: (item) => togglePlanItem(item.id),
                        })}
                      </div>

                      <label className="flex items-center gap-2 text-xs mb-4" style={{ opacity: 0.7 }}>
                        <input
                          type="checkbox"
                          checked={alsoSaveOutfit}
                          onChange={(e) => setAlsoSaveOutfit(e.target.checked)}
                        />
                        Garder aussi dans mes tenues
                      </label>

                      {reusableDup && !reusableDup.entryId && renderOutfitDupPanel(reusableDup.m, {
                        onView: () => { setShowQuickPlanModal(false); setReusableDup(null); changeView("tenues"); setDetailOutfitId(reusableDup.m.outfit.id); },
                        onForce: () => {
                          saveAsReusableOutfit(planItemIds, planLabel, undefined, undefined, true);
                          planItemsOnDate(planDate, planItemIds, planLabel);
                          setAlsoSaveOutfit(false);
                          setShowQuickPlanModal(false);
                        },
                        forceLabel: "Planifier et l'ajouter",
                      })}
                      <button
                        onClick={() => {
                          // Doublon possible : on montre l'encadré au-dessus et on attend la réponse.
                          if (alsoSaveOutfit && !reusableDup && !saveAsReusableOutfit(planItemIds, planLabel)) return;
                          planItemsOnDate(planDate, planItemIds, planLabel);
                          setAlsoSaveOutfit(false);
                          setReusableDup(null);
                          setShowQuickPlanModal(false);
                        }}
                        disabled={planItemIds.length === 0}
                        className="w-full flex items-center justify-center gap-1.5 px-5 h-12 rounded-full text-sm font-bold text-white"
                        style={{ background: COLORS.rose, opacity: planItemIds.length === 0 ? 0.4 : 1 }}
                      >
                        <Plus size={16} /> Enregistrer
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
      </div>

      {/* ── Petit message de confirmation ── */}
      {toast && (
        <div
          className="fixed flex items-center gap-2.5"
          style={{ left: 16, right: 16, bottom: "calc(80px + env(safe-area-inset-bottom, 0px))", maxWidth: 440, margin: "0 auto", padding: "12px 16px", borderRadius: 16, background: COLORS.ink, color: "#FFFFFF", boxShadow: "0 8px 20px rgba(0,0,0,0.25)", zIndex: 60, animation: "navLabelIn 0.2s ease-out" }}
        >
          <Check size={18} color={COLORS.rose} strokeWidth={2.4} />
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate" style={{ fontWeight: 700 }}>{String(toast.text).replace(/\s*✓\s*$/, "")}</p>
            {toast.sub && <p className="text-xs" style={{ opacity: 0.7 }}>{toast.sub}</p>}
          </div>
          {toast.action && (
            <button type="button" onClick={() => { toast.onAction(); setToast(null); }} className="text-sm" style={{ color: COLORS.rose, fontWeight: 700 }}>
              {toast.action}
            </button>
          )}
        </div>
      )}

      {/* ── Menu du "+" : 4 bulles en éventail au-dessus du bouton ── */}
      {showAddMenu && (
        <div onClick={() => setShowAddMenu(false)} className="fixed inset-0" style={{ background: "rgba(17,17,17,0.35)", zIndex: 44, animation: "fadeIn 0.15s ease-out" }}>
          {[
            { key: "vetement", label: "Un vêtement", Icon: Shirt, dx: -116, dy: 100, onClick: () => setShowAddForm(true) },
            { key: "tenue", label: "Une tenue", Icon: Layers, dx: -44, dy: 162, onClick: () => openCreateOutfit() },
            { key: "suggere", label: "Me suggérer", Icon: Sparkles, dx: 44, dy: 162, accent: true, onClick: () => { setShowAddMenu(false); openWizard(todayKey()); } },
            { key: "photo", label: "Photo du jour", Icon: Camera, dx: 116, dy: 100, photo: true },
          ].map((a, idx) => {
            const bubble = (
              <>
                <span className="flex items-center justify-center rounded-full" style={{ width: 56, height: 56, background: a.accent ? COLORS.rose : "#FFFFFF", boxShadow: "0 6px 16px rgba(0,0,0,0.18)" }}>
                  <a.Icon size={24} color={a.accent ? "#FFFFFF" : COLORS.ink} strokeWidth={1.9} />
                </span>
                <span className="text-xs" style={{ fontWeight: 700, color: "#FFFFFF", whiteSpace: "nowrap", padding: "2px 8px", borderRadius: 10, background: "rgba(17,17,17,0.6)" }}>{a.label}</span>
              </>
            );
            const style = {
              position: "fixed",
              left: `calc(50% + ${a.dx}px - 40px)`,
              bottom: `calc(${37 + a.dy - 28 - 6 - 22}px + env(safe-area-inset-bottom, 0px))`,
              width: 80,
              display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              animation: `fanOut 0.28s cubic-bezier(0.34, 1.56, 0.64, 1) ${idx * 0.03}s both`,
              "--fx": `${-a.dx}px`, "--fy": `${a.dy}px`,
            };
            return a.photo ? (
              <label key={a.key} onClick={(e) => e.stopPropagation()} style={style} className="cursor-pointer">
                {bubble}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(ev) => { handleWornPhoto(ev, todayKey(), null); setShowAddMenu(false); }}
                />
              </label>
            ) : (
              <button key={a.key} type="button" onClick={(e) => { e.stopPropagation(); a.onClick(); setShowAddMenu(false); }} style={style}>
                {bubble}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Barre de navigation fixe, claire, collée en bas : 4 onglets + le "+" au centre ── */}
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: "#FFFFFF", borderTop: `1px solid ${COLORS.line}`, paddingBottom: "env(safe-area-inset-bottom, 0px)", zIndex: 45 }}>
        <div style={{ maxWidth: 480, margin: "0 auto", height: 56, display: "flex", alignItems: "center", padding: "0 4px" }}>
          {[
            { key: "accueil", label: "Aujourd'hui", Icon: Sun },
            { key: "dressing", label: "Garde-robe", Icon: Shirt },
            { key: "plus" },
            { key: "tenues", label: "Tenues", Icon: Layers },
            { key: "agenda", label: "Agenda", Icon: Calendar },
          ].map(({ key, label, Icon }) => {
            if (key === "plus") {
              return (
                <div key="plus" style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                  <button
                    type="button"
                    onClick={() => setShowAddMenu((v) => !v)}
                    aria-label={showAddMenu ? "Fermer le menu" : "Ajouter"}
                    aria-expanded={showAddMenu}
                    className="flex items-center justify-center rounded-full"
                    style={{ width: 46, height: 46, marginTop: -18, background: COLORS.rose, border: "4px solid #FFFFFF", boxShadow: "0 3px 10px rgba(255,75,51,0.35)", boxSizing: "content-box", transition: "transform 0.25s", transform: showAddMenu ? "rotate(45deg)" : "none" }}
                  >
                    <Plus size={24} color="#FFFFFF" strokeWidth={2.4} />
                  </button>
                </div>
              );
            }
            const active = view === key;
            return (
              <button
                key={key}
                onClick={() => changeView(key)}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                style={{ flex: 1, height: 56, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}
              >
                <Icon size={20} color={active ? COLORS.ink : "#AAAAAA"} strokeWidth={1.8} />
                {active && (
                  <>
                    <span className="nav-label" style={{ fontSize: 10.5, fontWeight: 700, color: COLORS.ink, whiteSpace: "nowrap" }}>{label}</span>
                    <span style={{ width: 4, height: 4, borderRadius: 2, background: COLORS.rose }} />
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}