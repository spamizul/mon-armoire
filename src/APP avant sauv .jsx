import React, { useState, useEffect, useRef } from "react";
import { Plus, X, Pencil, ChevronDown, Shirt, Layers, Sparkles, Camera, Search, Heart, ArrowLeft, Link2, Clock, Calendar, Sun, Cloud, CloudRain, CloudSnow, CloudFog, CloudLightning } from "lucide-react";
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
const OCCASIONS = ["Travail", "Décontracté", "Soirée", "Sport"];
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
  ctx.drawImage(img, img.width * 0.2, img.height * 0.2, img.width * 0.6, img.height * 0.6, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const buckets = {};
  for (let p = 0; p < data.length; p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const k = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const bucket = buckets[k] || (buckets[k] = { count: 0, r: 0, g: 0, b: 0 });
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
  }
  // Les paniers du plus rempli au moins rempli, transformés en couleurs moyennes.
  const total = size * size;
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
  return canvas.toDataURL("image/jpeg", 0.75);
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
];
// Vue "toutes les pièces" (ouverte depuis les chiffres de la page Aujourd'hui) : un filtre en plus.
const ALL_ITEMS_VIEW = "__all";
const ALL_SORTS = [...CATEGORY_SORTS, { id: "mois", label: "Portées ce mois-ci" }];
// L'ordre des onglets détermine le sens du glissement : passer de "dressing"
// à "tenues" glisse vers la gauche, l'inverse glisse vers la droite.
const TAB_ORDER = ["accueil", "dressing", "tenues", "agenda"];

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
  }

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
  // Quelle tenue est actuellement affichée en fiche détaillée (null = aucune).
  const [detailOutfitId, setDetailOutfitId] = useState(null);
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
    return canvas.toDataURL("image/jpeg", 0.85);
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
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  // Valide le recadrage : découpe l'image et l'enregistre dans le formulaire.
  // Envoie une image (data URL) vers le stockage Supabase, et renvoie son lien public.
  // C'est ce lien (une simple ligne de texte) qui est enregistré dans l'appli désormais,
  // au lieu de l'image entière — ça évite de remplir le stockage limité du téléphone.
  async function uploadPhotoToStorage(dataUrl, label) {
    const blob = await (await fetch(dataUrl)).blob();
    const path = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const { error } = await supabase.storage.from("photos").upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
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
      const photoUrl = await uploadPhotoToStorage(croppedDataUrl, "photo");
      const thumbUrl = await uploadPhotoToStorage(await makeThumbnail(croppedDataUrl), "thumb");
      const originalUrl = await uploadPhotoToStorage(rawImageSrc, "original");
      if (cropTargetItemId) {
        // On modifie la photo d'un vêtement déjà enregistré, depuis sa fiche.
        // On garde aussi "photoOriginal" (la source utilisée pour ce recadrage), pour pouvoir
        // rouvrir le recadreur plus tard sur l'intégralité de l'image plutôt que sur un carré déjà coupé.
        const oldItem = items.find((i) => i.id === cropTargetItemId);
        setItems((prev) => prev.map((i) => (i.id === cropTargetItemId ? { ...i, photo: photoUrl, photoThumb: thumbUrl, photoOriginal: originalUrl, ...(detectedHex && { hex: detectedHex, extraHexes: detectedExtras }) } : i)));
        // On retire les anciennes versions du stockage, maintenant qu'elles ne sont plus utilisées.
        if (oldItem) {
          deleteFromStorage(oldItem.photo);
          deleteFromStorage(oldItem.photoThumb);
          deleteFromStorage(oldItem.photoOriginal);
        }
      } else {
        setForm((prev) => ({ ...prev, photo: photoUrl, photoThumb: thumbUrl, photoOriginal: originalUrl, ...(detectedHex && { hex: detectedHex, extraHexes: detectedExtras }) }));
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

  function addItem(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    const newItem = { id: Date.now(), ...form, pairsWith: [], wornDates: [] };
    setItems((prev) => [...prev, newItem]);
    setForm({ name: "", category: form.category, hex: "#C4808C", extraHexes: [], photo: null, weather: [], occasions: [] });
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

  // Trie une liste de vêtements : "couleur" (dégradé), "worn" (plus portés d'abord)
  // ou "recent" (derniers ajoutés d'abord).
  function sortItems(list, mode) {
    const copy = [...list];
    if (mode === "couleur") return copy.sort(compareByColor);
    if (mode === "worn") return copy.sort((a, b) => (b.wornDates || []).length - (a.wornDates || []).length);
    return copy.sort((a, b) => b.id - a.id);
  }

  // Vêtements affichés dans la page "Tout voir" de la catégorie ouverte.
  // "Favoris" et "Jamais portés" filtrent, puis on range par couleur.
  const categoryItems = categoryView
    ? sortItems(
        items
          .filter((i) => categoryView === ALL_ITEMS_VIEW || i.category === categoryView)
          .filter((i) => categorySort !== "favoris" || i.favorite)
          .filter((i) => categorySort !== "jamais" || (i.wornDates || []).length === 0)
          .filter((i) => categorySort !== "mois" || (i.wornDates || []).some((d) => new Date(d).toISOString().slice(0, 7) === new Date().toISOString().slice(0, 7))),
        categorySort === "favoris" || categorySort === "jamais" || categorySort === "mois" ? "couleur" : categorySort
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

  function saveOutfit(e) {
    e.preventDefault();
    commitOutfit();
    setShowOutfitForm(false);
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
  function randomFrom(category, colorAnchor, optional = false, prefOverride, avoid = new Set()) {
    const baseItem = wizardBaseItemId ? items.find((i) => i.id === wizardBaseItemId) : null;
    if (baseItem && effectiveCategory(baseItem) === category) return baseItem; // la pièce en tête est toujours incluse

    let pool = items.filter((i) => effectiveCategory(i) === category);
    if (pool.length === 0) return undefined;

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
      const sorted = [...pool].sort((a, b) => (b.wornDates || []).length - (a.wornDates || []).length);
      pool = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2))); // la moitié la plus portée
    } else if (pref === "oser") {
      const sorted = [...pool].sort((a, b) => (a.wornDates || []).length - (b.wornDates || []).length);
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
    pool = pool.filter((o) => !(o.wornDates || []).some((d) => new Date(d).getTime() > weekAgo));
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
    const sorted = [...pool].sort((a, b) => (b.wornDates || []).length - (a.wornDates || []).length);
    const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2))); // la moitié la plus portée
    return top[Math.floor(Math.random() * top.length)];
  }

  function suggestOutfit(avoidIds = []) {
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
    function pick(category, optional = false) {
      const item = randomFrom(category, colorAnchor, optional, category === starCat ? "souvent" : undefined, avoid);
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
    const found = picks.filter(Boolean);
    setSelectedIds(found.map((i) => i.id));
    setOutfitName(found.length >= 2 ? nextOutfitName() : "");
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
  function wizardSaveOutfit() {
    if (wizardTargetDate) {
      planItemsOnDate(wizardTargetDate, selectedIds, outfitName, wizardFromOutfitId || undefined);
    } else if (wizardFromOutfitId) {
      // Tenue déjà enregistrée : pas de doublon, on ouvre simplement sa fiche.
      changeView("tenues");
      setDetailOutfitId(wizardFromOutfitId);
    } else {
      commitOutfit();
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
  const hasOutfitFilter = outfitTagFilter.fav || outfitTagFilter.weather.length > 0 || outfitTagFilter.occasions.length > 0;
  const filteredOutfits = outfitsByRecent.filter((o) => {
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
    const d = item.wornDates || [];
    return d.length ? Math.max(...d.map((x) => new Date(x).getTime())) : 0;
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
      const worn = items.filter((it) => (it.wornDates || []).some((x) => new Date(x).toDateString() === dayStr));
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
  function renderFlatLay(planItems, height) {
    const order = (i) => CATEGORIES.indexOf(i.category);
    const list = [...planItems].sort((a, b) => order(a) - order(b)).slice(0, 6);
    const layout = FLATLAY_LAYOUTS[list.length] || FLATLAY_LAYOUTS[6];
    return (
      <div style={{ position: "relative", height, borderRadius: 18, background: "#FFFFFF", overflow: "hidden" }}>
        {list.map((item, idx) => {
          const [l, t, w, h, r] = layout[idx];
          return (
            <div
              key={item.id}
              style={{ position: "absolute", left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${h}%`, transform: `rotate(${r}deg)`, borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 14px rgba(0,0,0,0.12)", background: item.hex }}
            >
              {item.photo && (
                <img loading="lazy" decoding="async" src={item.photo} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
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
    setPlanDate("");
    setPlanItemIds([]);
    setPlanLabel("");
  }

  // Ajoute en plus cette sélection à la collection de tenues réutilisables (onglet Tenues).
  // Si dateStr/entryId sont fournis, on relie aussi l'entrée d'agenda à cette nouvelle tenue
  // (pour que "Portée aujourd'hui" reste synchronisé, comme pour une tenue créée normalement).
  function saveAsReusableOutfit(itemIds, label, dateStr, entryId) {
    if (itemIds.length === 0) return;
    const newOutfitId = Date.now() + 1;
    const newOutfit = { id: newOutfitId, name: label.trim() || nextOutfitName(), itemIds, favorite: false, wornDates: [], weather: [], occasions: [] };
    setOutfits((prev) => [...prev, newOutfit]);

    if (dateStr && entryId) {
      setAgenda((prev) => ({
        ...prev,
        [dateStr]: normalizeDayEntries(prev[dateStr]).map((e) => (e.id === entryId ? { ...e, outfitId: newOutfitId } : e)),
      }));
    }
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
  function renderWornPhotoBlock(entry) {
    const busy = uploadingWornFor === entry.entryId;
    if (entry.wornPhoto) {
      return (
        <div className="relative mb-3" style={{ borderRadius: 20, overflow: "hidden", background: COLORS.haze }}>
          <img src={entry.wornPhoto} alt={`Tenue portée — ${entry.label}`} style={{ width: "100%", maxHeight: "60vh", objectFit: "cover", display: "block", opacity: busy ? 0.5 : 1 }} />
          <div className="absolute flex gap-2" style={{ right: 12, bottom: 12 }}>
            <button
              type="button"
              onClick={() => askConfirm("Retirer cette photo ?", () => removeEntryWornPhoto(entry.dateStr, entry.entryId))}
              aria-label="Retirer la photo"
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.92)" }}
            >
              <X size={14} />
            </button>
            <label className="h-9 px-3.5 rounded-full flex items-center gap-1.5 text-sm cursor-pointer" style={{ background: "rgba(255,255,255,0.92)", fontWeight: 600 }}>
              <Camera size={14} /> {busy ? "Envoi…" : "Changer"}
              <input type="file" accept="image/*" onChange={(ev) => handleWornPhoto(ev, entry.dateStr, entry.entryId)} className="hidden" />
            </label>
          </div>
        </div>
      );
    }
    if (entry.dateStr > todayKey()) return null;
    return (
      <label className="flex flex-col items-center justify-center gap-1.5 mb-3 cursor-pointer text-center" style={{ height: 150, borderRadius: 20, border: "1.5px dashed #D5D3CF", background: "#FAFAF8" }}>
        <span className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "#FDE8E5" }}>
          <Camera size={18} color={COLORS.rose} />
        </span>
        <span className="text-sm" style={{ fontWeight: 600 }}>{busy ? "Envoi en cours…" : "Ajouter la photo portée"}</span>
        <span className="text-xs" style={{ color: COLORS.muted }}>Un selfie miroir suffit</span>
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

  // Toutes les tenues planifiées, toutes dates confondues, une ligne par tenue
  // (une même date peut donc apparaître plusieurs fois si plusieurs tenues y sont prévues).
  const agendaEntries = Object.entries(agenda)
    .flatMap(([dateStr, dayValue]) =>
      normalizeDayEntries(dayValue).map((entry) => ({
        dateStr,
        entryId: entry.id,
        label: entry.label,
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
    return (
      <div style={{ background: "#FFFFFF", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Karla:wght@400;500;600;700&family=Merriweather:ital,wght@0,400;0,700;1,400;1,700&display=swap');
          @keyframes splashIn {
            from { opacity: 0; transform: translateY(10px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes logoIn {
            from { opacity: 0; transform: scale(0.7); }
            to   { opacity: 1; transform: scale(1); }
          }
          .splash-mark  { animation: logoIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; opacity: 0; }
          .splash-logo { animation: splashIn 0.7s ease-out 0.25s forwards; opacity: 0; }
          .splash-tag   { animation: splashIn 0.7s ease-out 0.4s forwards; opacity: 0; }
        `}</style>
        <div style={{ textAlign: "center", fontFamily: "Karla, sans-serif" }}>
          <div
            className="splash-mark"
            style={{ width: 56, height: 56, borderRadius: "50%", background: "#FF4B33", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}
          >
            <Shirt size={26} color="#FFFFFF" />
          </div>
          <div className="splash-logo" style={{ fontSize: 28, fontWeight: 700, color: "#111111", fontFamily: "'Merriweather', serif" }}>
            Mon Armoire
          </div>
        </div>
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
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#FF4B33", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
            <Shirt size={26} color="#FFFFFF" />
          </div>
          <p style={{ fontSize: 22, fontWeight: 700, color: "#111111", marginBottom: 8, fontFamily: "'Merriweather', serif" }}>Bienvenue dans Mon Armoire</p>
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
        .slide-left  { animation: slideFromLeft 0.28s ease-out; }
        @keyframes wizardSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .wizard-spin { animation: wizardSpin 0.9s linear infinite; display: inline-flex; }
        .no-scrollbar { scrollbar-width: none; -webkit-overflow-scrolling: touch; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>

      <div
        className="max-w-3xl mx-auto px-5 pt-10 app-content"
        style={{ paddingBottom: 100 }}
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
                <h1 className="display" style={{ fontStyle: "italic", fontWeight: 700, fontSize: 32, lineHeight: 1.1, marginTop: 8 }}>{getGreeting(userName)}</h1>
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
            {/* Bouton principal de la page : générer une tenue pour aujourd'hui */}
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => openWizard(todayKey())}
                aria-label="Générer une tenue pour aujourd'hui"
                className="flex items-center justify-center rounded-full text-white"
                style={{ position: "fixed", right: 20, bottom: 84, width: 56, height: 56, background: COLORS.rose, boxShadow: "0 6px 18px rgba(255,75,51,0.35)", zIndex: 30 }}
              >
                <Sparkles size={24} />
              </button>
            )}
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
                            {entry.wornPhoto ? (
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
                          <button
                            type="button"
                            onClick={() => { if (!validated) validateTodayPlan(entry); }}
                            className="w-full mt-3 rounded-full flex items-center justify-center gap-1.5 text-sm"
                            style={{ height: 44, fontWeight: 600, background: validated ? "#FFFFFF" : COLORS.ink, color: validated ? COLORS.ink : "#FFFFFF" }}
                          >
                            {validated ? "Portée aujourd'hui ✓" : "Je la porte aujourd'hui"}
                          </button>
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
                          {d.planned.some((e) => e.wornPhoto)
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
              const wornThisMonth = items.filter((i) => (i.wornDates || []).some((d) => new Date(d).toISOString().slice(0, 7) === monthKey)).length;
              const neverWorn = items.filter((i) => (i.wornDates || []).length === 0).length;
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
              const entry = agendaEntries.find((e) => e.entryId === openEntryId);
              if (!entry) return null;
              const validated = isPlanValidatedToday(entry.planItems);
              return (
                <div
                  onClick={() => setOpenEntryId(null)}
                  className="fixed inset-0 flex items-end justify-center"
                  style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}
                >
                  {/* stopPropagation : un clic à l'intérieur de la popup ne doit pas la fermer */}
                  <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md px-5 pt-3 pb-8" style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}><div className="flex justify-center -mt-1 mb-3"><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                    <div className="flex items-center justify-between mb-4">
                      <p className="display" style={{ fontWeight: 700, fontSize: 19 }}>{entry.label}</p>
                      <button onClick={() => setOpenEntryId(null)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                        <X size={14} />
                      </button>
                    </div>

                    {renderWornPhotoBlock(entry)}

                    <div className="space-y-2 mb-3">
                      {entry.planItems.map((item) => (
                        <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg" style={{ background: COLORS.ivory }}>
                          <div className="rounded overflow-hidden" style={{ background: item.hex, width: 40, height: 40, border: `1px solid ${COLORS.line}` }}>
                            {item.photo && <img loading="lazy" decoding="async" src={thumbOf(item)} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium">{item.name}</p>
                            <p className="text-xs" style={{ color: COLORS.muted }}>{catLabel(item.category)}</p>
                          </div>
                          <button onClick={() => removeItemFromEntry(entry.dateStr, entry.entryId, item.id)} className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.06)" }}>
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Sélecteur repliable pour ajouter ou échanger un vêtement */}
                    <button
                      type="button"
                      onClick={() => setShowModalPicker((v) => !v)}
                      className="flex items-center gap-1.5 text-xs mb-3"
                      style={{ color: COLORS.rose }}
                    >
                      <Plus size={13} style={{ transform: showModalPicker ? "rotate(45deg)" : "none", transition: "transform 0.15s" }} />
                      {showModalPicker ? "Fermer" : "Ajouter ou échanger un vêtement"}
                    </button>

                    {showModalPicker && (
                      <div className="mb-4">
                        {renderItemRows({
                          exclude: (item) => entry.planItems.some((p) => p.id === item.id), // déjà dans la tenue → pas la peine de le reproposer
                          onPick: (item) => addItemToEntry(entry.dateStr, entry.entryId, item.id),
                          size: 68,
                        })}
                      </div>
                    )}

                    {/* Si cette tenue n'est pas encore dans la collection réutilisable, on propose de l'y ajouter */}
                    {!entry.outfitId && entry.planItems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => saveAsReusableOutfit(entry.planItems.map((i) => i.id), entry.label, entry.dateStr, entry.entryId)}
                        className="flex items-center gap-1.5 text-xs mb-3"
                        style={{ color: COLORS.ink, opacity: 0.6 }}
                      >
                        <Plus size={13} /> Ajouter à ma collection de tenues
                      </button>
                    )}

                    {entry.dateStr === todayKey() ? (
                      <button
                        onClick={() => { validateTodayPlan(entry); setOpenEntryId(null); }}
                        disabled={validated}
                        className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm"
                        style={{ background: COLORS.rose, color: "white" }}
                      >
                        {validated ? "Tenue validée ✓" : "Oui, je porte cette tenue aujourd'hui"}
                      </button>
                    ) : (
                      <button
                        onClick={() => setOpenEntryId(null)}
                        className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm"
                        style={{ background: COLORS.rose, color: "white" }}
                      >
                        C'est prêt
                      </button>
                    )}

                    <button
                      onClick={() => askConfirm("Supprimer cette tenue prévue ?", () => { removeAgendaEntry(entry.dateStr, entry.entryId); setOpenEntryId(null); })}
                      className="w-full text-center text-xs mt-3"
                      style={{ color: COLORS.muted }}
                    >
                      Supprimer cette tenue
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ══════════════════ VUE DRESSING ══════════════════ */}
        {view === "dressing" && !detailItem && (
          <div key={view + (categoryView || "")} className={categoryView ? "slide-right" : slideDir === "right" ? "slide-right" : "slide-left"}>
            {/* En-tête : "Garde-robe" en vue rangées, nom de la catégorie en vue "Tout voir" */}
            {!categoryView ? (
              <div className="flex items-end justify-between mb-6">
                <div>
                  <h1 className="display text-3xl" style={{ fontWeight: 700 }}>Garde-robe</h1>
                  <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
                    {items.length} pièce{items.length > 1 ? "s" : ""}
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
                  className="w-11 h-11 -ml-3 mb-1 rounded-full flex items-center justify-center"
                >
                  <ArrowLeft size={20} />
                </button>
                <h1 className="display text-3xl" style={{ fontWeight: 700 }}>{categoryView === ALL_ITEMS_VIEW ? "Toutes les pièces" : CATEGORY_PLURALS[categoryView] || categoryView}</h1>
                <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
                  {categoryItems.length} pièce{categoryItems.length > 1 ? "s" : ""}
                </p>
              </div>
            )}

            {/* Bouton flottant "+" pour ajouter un vêtement, au-dessus de la barre de navigation */}
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              aria-label="Ajouter un vêtement"
              className="flex items-center justify-center rounded-full text-white"
              style={{ position: "fixed", right: 20, bottom: 84, width: 56, height: 56, background: COLORS.rose, boxShadow: "0 6px 18px rgba(255,75,51,0.35)", zIndex: 30 }}
            >
              <Plus size={24} />
            </button>

            {showAddForm && (
              <div
                onClick={() => setShowAddForm(false)}
                className="fixed inset-0 flex items-end justify-center"
                style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}
              >
                <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md px-5 pt-3 pb-8" style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}><div className="flex justify-center -mt-1 mb-3"><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                  <div className="flex items-center justify-between mb-4">
                    <p className="display" style={{ fontWeight: 700, fontSize: 19 }}>Ajouter un vêtement</p>
                    <button onClick={() => setShowAddForm(false)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                      <X size={14} />
                    </button>
                  </div>
                  <form onSubmit={(e) => { addItem(e); setShowAddForm(false); }} className="flex flex-wrap gap-3 items-end">
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
                    <button type="submit" className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm text-white" style={{ background: COLORS.rose }}>
                      <Plus size={16} /> Ajouter
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* Barre de recherche, ouverte avec la loupe */}
            {showSearch && !categoryView && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-full mb-6" style={{ background: "#F3F2EF" }}>
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
                  {(categoryView === ALL_ITEMS_VIEW ? ALL_SORTS : CATEGORY_SORTS).map((s) => {
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
                    {categorySort === "favoris" ? "Aucun favori" : categorySort === "jamais" ? "Tout a déjà été porté ✓" : categorySort === "mois" ? "Rien de porté ce mois-ci" : "Vide"}
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

        {/* ══════════════════ FICHE ARTICLE (détail d'un vêtement) ══════════════════ */}
        {view === "dressing" && detailItem && (
          <div key={detailItemId} className="slide-right">
            <button type="button" onClick={() => setDetailItemId(null)} aria-label="Retour" className="w-11 h-11 -ml-3 mb-2 rounded-full flex items-center justify-center">
              <ArrowLeft size={20} />
            </button>

            <div className="mb-4 relative">
              {detailItem.photo ? (
                <img src={detailItem.photo} alt={detailItem.name} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 20, display: "block", background: COLORS.haze }} />
              ) : (
                <div style={{ background: detailItem.hex, aspectRatio: "1 / 1", borderRadius: 20 }} />
              )}
              <div className="absolute top-3 right-3 flex gap-1.5">
                {detailItem.photo && (
                  <button
                    type="button"
                    onClick={() => {
                      // On repart de la photo déjà enregistrée (pas d'un nouveau fichier),
                      // juste pour ajuster son cadrage. On repart de "photoOriginal" (la
                      // photo complète d'avant tout recadrage) si elle existe, plutôt que
                      // du résultat déjà découpé — pour retrouver toute l'image.
                      setRawImageSrc(detailItem.photoOriginal || detailItem.photo);
                      setCropPosition({ x: 0, y: 0 });
                      setCropZoom(1);
                      setCropTargetItemId(detailItem.id);
                      setShowCropModal(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs"
                    style={{ background: "rgba(0,0,0,0.55)", color: "white" }}
                  >
                    <Search size={13} /> Recadrer
                  </button>
                )}
                <label
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs cursor-pointer"
                  style={{ background: "rgba(0,0,0,0.55)", color: "white" }}
                >
                  <Camera size={13} /> {detailItem.photo ? "Modifier la photo" : "Ajouter une photo"}
                  <input type="file" accept="image/*" onChange={(e) => handlePhotoChange(e, detailItem.id)} className="hidden" />
                </label>
              </div>
              <div className="p-4 flex items-center justify-between gap-3">
                {renderEditableTitle(detailItem.name, (v) => setItems((prev) => prev.map((i) => (i.id === detailItem.id ? { ...i, name: v } : i))), "Nom du vêtement")}
                <button
                  type="button"
                  onClick={() => toggleFavoriteItem(detailItem.id)}
                  aria-label={detailItem.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                  className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center flex-shrink-0"
                >
                  <Heart size={20} color={detailItem.favorite ? COLORS.rose : COLORS.ink} fill={detailItem.favorite ? COLORS.rose : "none"} />
                </button>
              </div>
            </div>

            {/* Catégorie — modifiable si tu t'es trompée à l'ajout */}
            <div className="mb-5">
              <div className="flex gap-1.5 flex-wrap">
                {CATEGORIES.map((c) => {
                  const active = detailItem.category === c;
                  return (
                    <button
                      key={c}
                      onClick={() => setItems((prev) => prev.map((i) => i.id === detailItem.id ? { ...i, category: c } : i))}
                      className="px-4 h-9 rounded-full text-sm"
                      style={{
                        background: active ? COLORS.ink : "transparent",
                        color: active ? "white" : COLORS.ink,
                        border: `1px solid ${active ? COLORS.ink : COLORS.line}`,
                      }}
                    >
                      {catLabel(c)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Couleur — sert de vignette de secours sans photo, et alimente le générateur de tenue */}
            <div className="mb-5">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={detailItem.hex}
                  aria-label="Couleur principale"
                  onChange={(e) => setItems((prev) => prev.map((i) => i.id === detailItem.id ? { ...i, hex: e.target.value } : i))}
                  className="w-12 h-9 rounded-xl cursor-pointer"
                  style={{ border: `1px solid ${COLORS.line}` }}
                />
                {/* Couleurs secondaires (motifs) : 2 max, modifiables et supprimables */}
                {(detailItem.extraHexes || []).map((hex, idx) => (
                  <span key={idx} className="relative">
                    <input
                      type="color"
                      value={hex}
                      aria-label={`Couleur secondaire ${idx + 1}`}
                      onChange={(e) => setItems((prev) => prev.map((i) => i.id === detailItem.id ? { ...i, extraHexes: (i.extraHexes || []).map((h, k) => (k === idx ? e.target.value : h)) } : i))}
                      className="w-9 h-9 rounded-full cursor-pointer"
                      style={{ border: `1px solid ${COLORS.line}` }}
                    />
                    <button
                      type="button"
                      onClick={() => setItems((prev) => prev.map((i) => i.id === detailItem.id ? { ...i, extraHexes: (i.extraHexes || []).filter((_, k) => k !== idx) } : i))}
                      aria-label="Retirer cette couleur"
                      className="absolute w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ top: -6, right: -6, background: "#FFFFFF", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {(detailItem.extraHexes || []).length < 2 && (
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.map((i) => i.id === detailItem.id ? { ...i, extraHexes: [...(i.extraHexes || []), "#cccccc"] } : i))}
                    aria-label="Ajouter une couleur (motif)"
                    className="w-9 h-9 rounded-full flex items-center justify-center"
                    style={{ border: `1.5px dashed ${COLORS.line}`, color: COLORS.muted }}
                  >
                    <Plus size={15} />
                  </button>
                )}
                {detailItem.photo && (
                  <button
                    type="button"
                    onClick={() => detectItemColor(detailItem)}
                    disabled={detectingColors === detailItem.id}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs"
                    style={{ border: `1px solid ${COLORS.line}`, opacity: detectingColors === detailItem.id ? 0.5 : 1 }}
                  >
                    <Sparkles size={13} />
                    {detectingColors === detailItem.id ? "…" : "Détecter"}
                  </button>
                )}
              </div>
            </div>

            {/* Météo — "|| []" au cas où ce vêtement existait avant l'ajout de ce champ */}
            <div className="mb-5">
              <div className="flex gap-1.5 flex-wrap">
                {WEATHER_TAGS.map((w) => {
                  const active = (detailItem.weather || []).includes(w);
                  return (
                    <button key={w} onClick={() => setItems((prev) => prev.map((i) => i.id === detailItem.id ? { ...i, weather: active ? (i.weather || []).filter((x) => x !== w) : [...(i.weather || []), w] } : i))}
                      className="px-4 h-9 rounded-full text-sm" style={{
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

            {/* Occasion — "|| []" au cas où ce vêtement existait avant l'ajout de ce champ */}
            <div className="mb-5">
              <div className="flex gap-1.5 flex-wrap">
                {OCCASIONS.map((o) => {
                  const active = (detailItem.occasions || []).includes(o);
                  return (
                    <button key={o} onClick={() => setItems((prev) => prev.map((i) => i.id === detailItem.id ? { ...i, occasions: active ? (i.occasions || []).filter((x) => x !== o) : [...(i.occasions || []), o] } : i))}
                      className="px-4 h-9 rounded-full text-sm" style={{
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

            {/* Va bien avec */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Link2 size={13} style={{ opacity: 0.6 }} />
                  <p className="text-xs font-medium" style={{ opacity: 0.6 }}>Va bien avec</p>
                </div>
                <button
                  onClick={() => setShowPairsModal(true)}
                  className="text-xs px-2.5 py-1 rounded-full"
                  style={{ border: `1px solid ${COLORS.line}`, color: COLORS.ink }}
                >
                  Choisir
                </button>
              </div>

              {(detailItem.pairsWith || []).length === 0 ? (
                <p className="text-xs" style={{ opacity: 0.5 }}>Aucune</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {(detailItem.pairsWith || []).map((otherId) => {
                    const other = items.find((i) => i.id === otherId);
                    if (!other) return null;
                    return (
                      <div key={other.id} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${COLORS.line}` }}>
                        <div style={{ background: other.hex, aspectRatio: "1 / 1", overflow: "hidden" }}>
                          {other.photo && <img loading="lazy" decoding="async" src={thumbOf(other)} alt={other.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Popup de sélection des associations ── */}
            {showPairsModal && (
              <div
                onClick={() => setShowPairsModal(false)}
                className="fixed inset-0 flex items-end justify-center"
                style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}
              >
                <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md px-5 pt-3 pb-8" style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}><div className="flex justify-center -mt-1 mb-3"><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                  <div className="flex items-center justify-between mb-4">
                    <p className="display" style={{ fontWeight: 700, fontSize: 19 }}>Va bien avec</p>
                    <button onClick={() => setShowPairsModal(false)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                      <X size={14} />
                    </button>
                  </div>

                  {renderItemRows({
                    exclude: (i) => i.id === detailItem.id,
                    isSelected: (i) => (detailItem.pairsWith || []).includes(i.id),
                    onPick: (i) => togglePair(detailItem.id, i.id),
                  })}
                </div>
              </div>
            )}

            {/* Notes libres */}
            <div className="mb-5">
              <textarea
                value={detailItem.notes || ""}
                onChange={(e) => setItems((prev) => prev.map((i) => (i.id === detailItem.id ? { ...i, notes: e.target.value } : i)))}
                placeholder="Notes…"
                rows={3}
                className="w-full px-4 py-2.5 rounded-xl text-sm"
                style={{ border: `1px solid ${COLORS.line}`, outline: "none", resize: "vertical" }}
              />
            </div>

            {/* Historique de port */}
            <div className="mb-5">
              <div className="flex items-center gap-1.5 mb-2">
                <Clock size={13} style={{ opacity: 0.6 }} />
                <p className="text-xs font-medium" style={{ opacity: 0.6 }}>
                  {(detailItem.wornDates || []).length === 0 ? "Jamais porté" : `Porté ${(detailItem.wornDates || []).length} fois`}
                </p>
              </div>
              {(detailItem.wornDates || []).length === 0 ? (
                null
              ) : (
                <p className="text-xs" style={{ opacity: 0.7 }}>
                  Dernière fois : {formatDate(detailItem.wornDates[(detailItem.wornDates || []).length - 1])}
                </p>
              )}
            </div>

            <button onClick={() => askConfirm("Supprimer ce vêtement ?", () => removeItem(detailItem.id))} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs" style={{ border: `1px solid ${COLORS.rose}`, color: COLORS.rose }}>
              <X size={13} /> Supprimer
            </button>
          </div>
        )}

        {/* ══════════════════ VUE TENUES ══════════════════ */}
        {view === "tenues" && (
          <div key={view} className={slideDir === "right" ? "slide-right" : "slide-left"}>
            {!detailOutfitId && (
            <div className="flex items-end justify-between mb-6">
              <div>
                <h1 className="display text-3xl" style={{ fontWeight: 700 }}>Tenues</h1>
                <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
                  {hasOutfitFilter ? `${filteredOutfits.length} sur ${outfits.length}` : outfits.length} tenue{outfits.length > 1 ? "s" : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setCreateOutfitStep("select"); setOutfitTags(EMPTY_OUTFIT_TAGS); setOutfitName(nextOutfitName()); setSelectedIds([]); setShowOutfitForm(true); }}
                aria-label="Créer une tenue"
                className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center"
                style={{ color: COLORS.ink }}
              >
                <Plus size={22} />
              </button>
            </div>
            )}

            {/* Bouton principal de la page : générer une tenue */}
            <button
              type="button"
              onClick={() => openWizard()}
              aria-label="Générer une tenue"
              className="flex items-center justify-center rounded-full text-white"
              style={{ position: "fixed", right: 20, bottom: 84, width: 56, height: 56, background: COLORS.rose, boxShadow: "0 6px 18px rgba(255,75,51,0.35)", zIndex: 30 }}
            >
              <Sparkles size={24} />
            </button>

            {showOutfitForm && (
              <div
                onClick={() => setShowOutfitForm(false)}
                className="fixed inset-0 flex items-end justify-center"
                style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}
              >
                {/* Panneau qui monte du bas de l'écran */}
                <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md px-5 pt-2" style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}>
                  <div className="flex justify-center mb-2">
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

                        <button type="submit" disabled={!outfitName.trim() || selectedIds.length === 0} className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm text-white" style={{ background: COLORS.rose, opacity: !outfitName.trim() || selectedIds.length === 0 ? 0.4 : 1 }}>
                          <Plus size={16} /> Enregistrer la tenue
                        </button>
                        <div className="h-6" />
                      </>
                    )}
                  </form>
                </div>
              </div>
            )}

            {!detailOutfitId && (
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

                {/* ── Tags pour ne garder que les tenues concernées ── */}
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

                {/* ── Toutes les tenues, en grille ── */}
                {filteredOutfits.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-sm mb-3" style={{ color: COLORS.muted }}>Aucune tenue avec ces tags</p>
                    <button type="button" onClick={() => setOutfitTagFilter({ fav: false, weather: [], occasions: [] })} className="text-sm" style={{ color: COLORS.rose, fontWeight: 500 }}>
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

            {/* ══════════════════ FICHE TENUE (détail d'une tenue enregistrée) ══════════════════ */}
            {detailOutfitId && (() => {
              const outfit = outfits.find((o) => o.id === detailOutfitId);
              if (!outfit) return null;
              const validated = isWornToday(outfit);
              return (
                <div>
                  <button type="button" onClick={() => setDetailOutfitId(null)} aria-label="Retour aux tenues" className="w-11 h-11 -ml-3 mb-2 rounded-full flex items-center justify-center">
                    <ArrowLeft size={20} />
                  </button>

                  <div className="flex items-center justify-between mb-3">
                    {renderEditableTitle(outfit.name, (v) => setOutfits((prev) => prev.map((o) => (o.id === outfit.id ? { ...o, name: v } : o))), "Nom de la tenue")}
                    <div className="flex gap-1">
                      <button onClick={() => toggleFavoriteOutfit(outfit.id)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.06)" }}>
                        <Heart size={15} color={outfit.favorite ? COLORS.rose : COLORS.ink} fill={outfit.favorite ? COLORS.rose : "none"} />
                      </button>
                    </div>
                  </div>

                  {(() => {
                    const pal = outfitPalette(outfit);
                    if (pal.length === 0) return null;
                    return (
                      <div className="mb-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs" style={{ color: COLORS.muted }}>Palette</span>
                          {renderPaletteDots(pal, 22)}
                        </div>
                        <div style={{ height: 4, borderRadius: 2, background: pal.length > 1 ? `linear-gradient(90deg, ${pal.join(", ")})` : pal[0] }} />
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-5">
                    {itemsForOutfit(outfit).map((item) => (
                      <div key={item.id} className="rounded-xl overflow-hidden" style={{ background: COLORS.haze }}>
                        {item.photo ? (
                          <img loading="lazy" decoding="async" src={thumbOf(item)} alt={item.name} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
                        ) : (
                          <div style={{ background: item.hex, aspectRatio: "1 / 1" }} />
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Météo */}
                  <div className="mb-5">
                    <div className="flex gap-1.5 flex-wrap">
                      {WEATHER_TAGS.map((w) => {
                        const active = (outfit.weather || []).includes(w);
                        return (
                          <button key={w} onClick={() => setOutfits((prev) => prev.map((o) => o.id === outfit.id ? { ...o, weather: active ? (o.weather || []).filter((x) => x !== w) : [...(o.weather || []), w] } : o))}
                            className="px-4 h-9 rounded-full text-sm" style={{
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

                  {/* Occasion */}
                  <div className="mb-5">
                    <div className="flex gap-1.5 flex-wrap">
                      {OCCASIONS.map((o2) => {
                        const active = (outfit.occasions || []).includes(o2);
                        return (
                          <button key={o2} onClick={() => setOutfits((prev) => prev.map((o) => o.id === outfit.id ? { ...o, occasions: active ? (o.occasions || []).filter((x) => x !== o2) : [...(o.occasions || []), o2] } : o))}
                            className="px-4 h-9 rounded-full text-sm" style={{
                              background: active ? COLORS.ink : "transparent",
                              color: active ? "white" : COLORS.ink,
                              border: `1px solid ${active ? COLORS.ink : COLORS.line}`,
                            }}>
                            {o2}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Historique de port */}
                  <div className="mb-5">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Clock size={13} style={{ opacity: 0.6 }} />
                      <p className="text-xs font-medium" style={{ opacity: 0.6 }}>
                        {(outfit.wornDates || []).length === 0 ? "Jamais portée" : `Portée ${(outfit.wornDates || []).length} fois`}
                      </p>
                    </div>
                    {(outfit.wornDates || []).length === 0 ? (
                      null
                    ) : (
                      <p className="text-xs" style={{ opacity: 0.7 }}>
                        Dernière fois : {formatDate(outfit.wornDates[outfit.wornDates.length - 1])}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => (validated ? unmarkOutfitWorn(outfit) : markOutfitWorn(outfit))}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs"
                      style={
                        validated
                          ? { background: COLORS.rose, color: "white", border: `1px solid ${COLORS.rose}` }
                          : { border: `1px solid ${COLORS.gold}`, color: COLORS.gold }
                      }
                    >
                      {validated ? "Portée aujourd'hui ✓" : "Portée aujourd'hui"}
                    </button>
                    <button onClick={() => askConfirm("Supprimer cette tenue ?", () => { removeOutfit(outfit.id); setDetailOutfitId(null); })} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs" style={{ border: `1px solid ${COLORS.rose}`, color: COLORS.rose }}>
                      <X size={13} /> Supprimer cette tenue
                    </button>
                  </div>
                </div>
              );
            })()}

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

            {agendaTab === "carnet" ? (
              <label
                aria-label="Ajouter la photo de ta tenue du jour"
                className="flex items-center justify-center rounded-full text-white cursor-pointer"
                style={{ position: "fixed", right: 20, bottom: 84, width: 56, height: 56, background: COLORS.rose, boxShadow: "0 6px 18px rgba(255,75,51,0.35)", zIndex: 30, opacity: uploadingWornFor ? 0.6 : 1 }}
              >
                <Camera size={24} />
                <input type="file" accept="image/*" onChange={(ev) => handleWornPhoto(ev, todayKey(), null)} className="hidden" />
              </label>
            ) : items.length > 0 && (
              <button
                type="button"
                onClick={() => openQuickPlan(todayKey())}
                aria-label="Planifier une tenue"
                className="flex items-center justify-center rounded-full text-white"
                style={{ position: "fixed", right: 20, bottom: 84, width: 56, height: 56, background: COLORS.rose, boxShadow: "0 6px 18px rgba(255,75,51,0.35)", zIndex: 30 }}
              >
                <Plus size={24} />
              </button>
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
                    <p className="text-sm" style={{ color: COLORS.muted }}>Prends-toi en photo avec ta tenue du jour : un selfie miroir suffit.</p>
                  </div>
                );
              }
              return (
                <>
                  <p className="text-sm mb-3" style={{ color: COLORS.muted }}>{shots.length} look{shots.length > 1 ? "s" : ""} porté{shots.length > 1 ? "s" : ""}</p>
                  <div style={{ columnCount: 2, columnGap: 10 }}>
                    {shots.map((entry) => (
                      <button
                        key={entry.entryId}
                        type="button"
                        onClick={() => setDayViewDate(entry.dateStr)}
                        aria-label={`${formatShortDate(entry.dateStr)} — ${entry.label}`}
                        className="relative w-full block mb-2.5 overflow-hidden"
                        style={{ borderRadius: 18, background: COLORS.haze, breakInside: "avoid" }}
                      >
                        <img loading="lazy" decoding="async" src={entry.wornPhoto} alt="" style={{ width: "100%", display: "block" }} />
                        <span className="absolute text-xs" style={{ left: 8, bottom: 8, padding: "3px 9px", borderRadius: 999, background: "rgba(255,255,255,0.92)", fontWeight: 600 }}>
                          {formatShortDate(entry.dateStr)}
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
                  const hasEntries = agendaEntries.some((e) => e.dateStr === dateKey);
                  const isToday = dateKey === todayKey();
                  return (
                    <button
                      key={i}
                      onClick={() => setDayViewDate(dateKey)}
                      className="aspect-square rounded-md flex flex-col items-center justify-center relative text-[11px]"
                      style={{
                        background: isToday ? COLORS.ink : hasEntries ? "#FDE8E5" : "transparent",
                        color: isToday ? "white" : hasEntries ? COLORS.rose : COLORS.ink,
                        fontWeight: hasEntries || isToday ? 600 : 400,
                      }}
                    >
                      {day}
                      {hasEntries && (
                        <span
                          className="absolute rounded-full"
                          style={{ bottom: 2, width: 5, height: 5, background: isToday ? "white" : COLORS.rose }}
                        />
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
                          onClick={() => setDayViewDate(entry.dateStr)}
                          aria-label={`${formatShortDate(entry.dateStr)} — ${entry.label}`}
                          className="flex-shrink-0 text-left"
                          style={{ width: 104, opacity: isPast ? 0.55 : 1 }}
                        >
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
                            {entry.wornPhoto ? (
                              <img loading="lazy" decoding="async" src={entry.wornPhoto} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", gridColumn: "1 / -1", gridRow: "1 / -1" }} />
                            ) : shown.map((item) => (
                              item.photo ? (
                                <img loading="lazy" decoding="async" key={item.id} src={thumbOf(item)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                              ) : (
                                <div key={item.id} style={{ background: item.hex, width: "100%", height: "100%" }} />
                              )
                            ))}
                          </div>
                          <p className="text-xs mt-1.5" style={{ color: isToday ? COLORS.rose : COLORS.muted, fontWeight: isToday ? 600 : 400 }}>
                            {formatShortDate(entry.dateStr)}
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
                  ><div className="flex justify-center -mt-1 mb-3"><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                    <div className="flex items-center justify-between mb-4">
                      <button onClick={() => prevPlannedDate(dayViewDate) && setDayViewDate(prevPlannedDate(dayViewDate))} disabled={!prevPlannedDate(dayViewDate)} aria-label="Tenue précédente" className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: COLORS.haze, opacity: prevPlannedDate(dayViewDate) ? 1 : 0.3 }}>
                        <ArrowLeft size={15} />
                      </button>
                      <p className="text-sm font-medium text-center" style={{ flex: 1 }}>
                        {dayViewDate === todayKey() ? "Aujourd'hui" : formatAgendaDate(dayViewDate)}
                      </p>
                      <button onClick={() => nextPlannedDate(dayViewDate) && setDayViewDate(nextPlannedDate(dayViewDate))} disabled={!nextPlannedDate(dayViewDate)} aria-label="Tenue suivante" className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: COLORS.haze, opacity: nextPlannedDate(dayViewDate) ? 1 : 0.3 }}>
                        <ArrowLeft size={15} style={{ transform: "rotate(180deg)" }} />
                      </button>
                    </div>

                    {dayEntries.length === 0 ? (
                      <p className="text-xs py-4 text-center" style={{ opacity: 0.5 }}>Rien de prévu</p>
                    ) : (
                      <div className="space-y-3 mb-4">
                        {dayEntries.map((entry) => (
                          <div key={entry.entryId}>
                            {renderWornPhotoBlock(entry)}
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <p className="text-sm truncate" style={{ fontWeight: 600 }}>{entry.label}</p>
                                {entry.planItems.length > 0 && renderPaletteDots([...new Set(entry.planItems.flatMap(itemColors).map((h) => h.toLowerCase()))].slice(0, 5), 12)}
                              </div>
                              <button
                                type="button"
                                onClick={() => askConfirm("Supprimer cette tenue prévue ?", () => removeAgendaEntry(entry.dateStr, entry.entryId))}
                                aria-label="Supprimer cette tenue prévue"
                                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                                style={{ background: COLORS.haze }}
                              >
                                <X size={13} />
                              </button>
                            </div>
                            <div className={entry.wornPhoto ? "grid grid-cols-5 gap-2" : "grid grid-cols-3 gap-2"}>
                              {entry.planItems.map((item) => (
                                <div key={item.id} className="rounded-xl overflow-hidden" style={{ background: COLORS.haze }}>
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

                    <button
                      onClick={() => { const d = dayViewDate; setDayViewDate(null); openQuickPlan(d); }}
                      className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm"
                      style={{ border: `1px solid ${COLORS.gold}`, color: COLORS.gold }}
                    >
                      <Plus size={14} /> Planifier une tenue pour ce jour
                    </button>
                  </div>
                </div>
              );
            })()}
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
                      className="flex-1 px-4 py-2.5 rounded-full text-sm"
                      style={{ border: `1px solid ${COLORS.line}`, color: COLORS.ink }}
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
                      className="flex-1 px-4 py-2.5 rounded-full text-sm text-white"
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
                  <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md px-5 pt-3 pb-8" style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}><div className="flex justify-center -mt-1 mb-3"><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="display" style={{ fontWeight: 700, fontSize: 19 }}>Suggère-moi une tenue</p>
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
                            <button type="button" onClick={() => removeWizardItem(wizardSwap)} className="w-full px-4 py-2 rounded-full text-sm" style={{ border: `1px solid ${COLORS.rose}`, color: COLORS.rose }}>
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
                          const n = o ? (o.wornDates || []).length : 0;
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

                        <div className="flex gap-2">
                          <button onClick={wizardGenerate} className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm" style={{ border: `1px solid ${COLORS.line}`, color: COLORS.ink }}>
                            <Sparkles size={14} /> Régénérer
                          </button>
                          <button
                            onClick={wizardSaveOutfit}
                            disabled={selectedIds.length === 0 || (!wizardTargetDate && !outfitName.trim())}
                            className="flex-1 px-4 py-2 rounded-full text-sm text-white"
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
                        <button onClick={wizardBack} className="flex items-center gap-1 px-4 py-2 rounded-full text-sm" style={{ border: `1px solid ${COLORS.line}`, color: COLORS.ink }}>
                          <ArrowLeft size={14} /> Précédent
                        </button>
                      )}
                      {!isLast ? (
                        <button onClick={wizardNext} className="flex-1 px-4 py-2 rounded-full text-sm text-white" style={{ background: COLORS.rose }}>
                          Suivant
                        </button>
                      ) : (
                        <button onClick={wizardGenerate} className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm text-white" style={{ background: COLORS.rose }}>
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
                <div className="w-full max-w-md px-5 pt-3 pb-8" style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0" }}><div className="flex justify-center -mt-1 mb-3"><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
                  <div className="flex items-center justify-between mb-4">
                    <p className="display" style={{ fontWeight: 700, fontSize: 19 }}>Recadrer la photo</p>
                    <button onClick={() => { setShowCropModal(false); setRawImageSrc(null); }} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                      <X size={14} />
                    </button>
                  </div>

                  {/* Le recadreur a besoin d'un conteneur avec une hauteur fixe et position relative */}
                  <div style={{ position: "relative", width: "100%", height: 280, background: "#222", borderRadius: 8, overflow: "hidden" }}>
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
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm text-white"
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
                <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md px-5 pt-3 pb-8" style={{ background: "#FFFFFF", borderRadius: "24px 24px 0 0", maxHeight: "92vh", overflowY: "auto" }}><div className="flex justify-center -mt-1 mb-3"><span style={{ width: 36, height: 4, borderRadius: 2, background: "#E2E0DC" }} /></div>
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

                      <button
                        onClick={() => {
                          if (alsoSaveOutfit) saveAsReusableOutfit(planItemIds, planLabel);
                          planItemsOnDate(planDate, planItemIds, planLabel);
                          setAlsoSaveOutfit(false);
                          setShowQuickPlanModal(false);
                        }}
                        disabled={planItemIds.length === 0}
                        className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm text-white"
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

      {/* ── Barre de navigation flottante, fixée en bas de l'écran ── */}
      <div style={{ position: "fixed", bottom: 14, left: 0, right: 0, display: "flex", justifyContent: "center", zIndex: 40 }}>
        <div style={{ display: "flex", background: "#111111", borderRadius: 999, padding: "6px 8px", gap: 4, boxShadow: "0 6px 16px rgba(0,0,0,0.18)" }}>
          {[
            { key: "accueil", label: "Aujourd'hui", Icon: Sun },
            { key: "dressing", label: "Garde-robe", Icon: Shirt },
            { key: "tenues", label: "Tenues", Icon: Layers },
            { key: "agenda", label: "Agenda", Icon: Calendar },
          ].map(({ key, label, Icon }) => {
            const active = view === key;
            return (
              <button
                key={key}
                onClick={() => changeView(key)}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className="flex items-center justify-center"
                style={{
                  // Onglet actif : icône + nom dans une pastille corail. Les autres : icône seule.
                  height: 44,
                  minWidth: 44,
                  padding: active ? "0 16px 0 13px" : "0 12px",
                  gap: 6,
                  borderRadius: 999,
                  background: active ? COLORS.ink : "transparent",
                  transition: "background 0.2s, padding 0.2s",
                }}
              >
                <Icon size={18} color={active ? "white" : "#AAAAAA"} />
                {active && <span style={{ fontSize: 13, fontWeight: 600, color: "white", whiteSpace: "nowrap" }}>{label}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}