import React, { useState, useEffect, useRef } from "react";
import { Plus, X, Check, Shirt, Layers, Sparkles, Camera, Home, Search, Heart, ArrowLeft, Link2, Clock, Calendar, Sun, Cloud, CloudRain, CloudSnow, CloudFog, CloudLightning } from "lucide-react";
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

const CATEGORIES = ["Haut", "Pull", "Chemise", "Veste", "Robe", "Bas", "Chaussures", "Accessoire"];
const SEASONS = ["Printemps", "Été", "Automne", "Hiver"];
const WEATHER_TAGS = ["Chaud", "Frais", "Froid", "Pluie"];
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
async function detectDominantColor(src) {
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
  let best = null;
  for (const k in buckets) if (!best || buckets[k].count > best.count) best = buckets[k];
  const toHex = (v) => Math.round(v / best.count).toString(16).padStart(2, "0");
  return `#${toHex(best.r)}${toHex(best.g)}${toHex(best.b)}`;
}

const EMPTY_OUTFIT_TAGS = { seasons: [], weather: [], occasions: [] };

// Noms au pluriel pour les titres de rangées de la Garde-robe.
const CATEGORY_PLURALS = {
  Haut: "Hauts", Pull: "Pulls", Chemise: "Chemises", Veste: "Vestes", Robe: "Robes",
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
// L'ordre des onglets détermine le sens du glissement : passer de "dressing"
// à "tenues" glisse vers la gauche, l'inverse glisse vers la droite.
const TAB_ORDER = ["accueil", "dressing", "tenues", "agenda"];

function getGreeting(name) {
  const hour = new Date().getHours();
  if (hour < 12) return `Bonjour ${name} ✨`;
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
  // Météo du jour, affichée sur la page Profil. "idle"/"loading"/"granted"/"denied"/"error".
  const [weather, setWeather] = useState(null);
  const [weatherStatus, setWeatherStatus] = useState("idle");
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

  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  // Page "Tout voir" : la catégorie affichée en grille complète (null = vue en rangées).
  const [categoryView, setCategoryView] = useState(null);
  const [categorySort, setCategorySort] = useState("couleur");
  // Id du vêtement dont la couleur est en cours de détection (null = aucune).
  const [detectingColors, setDetectingColors] = useState(null);

  const [form, setForm] = useState({ name: "", category: "Haut", hex: "#C4808C", photo: null, seasons: [], weather: [], occasions: [] });
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
  // Contrôle l'ouverture de la popup "tenue du jour" sur la page Profil.
  // Identifiant de l'entrée d'agenda actuellement ouverte en popup (null = fermée).
  // On garde l'id plutôt qu'un simple booléen car il peut y avoir plusieurs tenues le même jour.
  const [openEntryId, setOpenEntryId] = useState(null);
  // Contrôle le petit sélecteur "ajouter/échanger" à l'intérieur de la popup tenue du jour.
  const [showModalPicker, setShowModalPicker] = useState(false);
  const [modalPickerFilter, setModalPickerFilter] = useState("Tous");

  const [outfitName, setOutfitName] = useState("");
  // Tags choisis pour la tenue en cours de création (saisons, météo, occasions).
  const [outfitTags, setOutfitTags] = useState(EMPTY_OUTFIT_TAGS);
  const [selectedIds, setSelectedIds] = useState([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [outfitSeasonFilter, setOutfitSeasonFilter] = useState("Tous");
  const [outfitWeatherFilter, setOutfitWeatherFilter] = useState("Tous");
  const [outfitOccasionFilter, setOutfitOccasionFilter] = useState("Tous");
  // Filtre catégorie pour le sélecteur de vêtements, séparé pour chaque écran
  // (choisir "Bas" dans Tenues ne doit pas affecter le sélecteur de l'Agenda).
  const [outfitPickerFilter, setOutfitPickerFilter] = useState("Tous");
  const [agendaPickerFilter, setAgendaPickerFilter] = useState("Tous");

  // Champs du formulaire de planification dans l'agenda.
  const [planDate, setPlanDate] = useState("");
  const [planItemIds, setPlanItemIds] = useState([]);
  const [planLabel, setPlanLabel] = useState(""); // ex: "Soir" — permet plusieurs tenues le même jour
  // Popup de sélection rapide, ouverte depuis Profil (aujourd'hui/demain) sans quitter la page.
  const [showQuickPlanModal, setShowQuickPlanModal] = useState(false);
  // "choice" (choisir la méthode) | "existing" (tenue déjà enregistrée) | "create" (sélection manuelle)
  const [quickPlanMode, setQuickPlanMode] = useState("choice");
  // Coché : la tenue créée via "Planifier" sera aussi enregistrée dans la collection de tenues.
  const [alsoSaveOutfit, setAlsoSaveOutfit] = useState(false);
  // Le mois actuellement affiché dans le calendrier de l'agenda.
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  // La date dont on affiche le détail dans la popup "jour" (null = fermée).
  const [dayViewDate, setDayViewDate] = useState(null);

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
  const [pairsPickerFilter, setPairsPickerFilter] = useState("Tous");

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
    const { error } = await supabase.storage.from("photos").upload(path, blob, { contentType: "image/jpeg" });
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
      try {
        detectedHex = await detectDominantColor(croppedDataUrl);
      } catch (err) {}
      const photoUrl = await uploadPhotoToStorage(croppedDataUrl, "photo");
      const originalUrl = await uploadPhotoToStorage(rawImageSrc, "original");
      if (cropTargetItemId) {
        // On modifie la photo d'un vêtement déjà enregistré, depuis sa fiche.
        // On garde aussi "photoOriginal" (la source utilisée pour ce recadrage), pour pouvoir
        // rouvrir le recadreur plus tard sur l'intégralité de l'image plutôt que sur un carré déjà coupé.
        const oldItem = items.find((i) => i.id === cropTargetItemId);
        setItems((prev) => prev.map((i) => (i.id === cropTargetItemId ? { ...i, photo: photoUrl, photoOriginal: originalUrl, ...(detectedHex && { hex: detectedHex }) } : i)));
        // On retire les anciennes versions du stockage, maintenant qu'elles ne sont plus utilisées.
        if (oldItem) {
          deleteFromStorage(oldItem.photo);
          deleteFromStorage(oldItem.photoOriginal);
        }
      } else {
        setForm((prev) => ({ ...prev, photo: photoUrl, photoOriginal: originalUrl, ...(detectedHex && { hex: detectedHex }) }));
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
    setForm({ name: "", category: form.category, hex: "#C4808C", photo: null, seasons: [], weather: [], occasions: [] });
  }

  function removeItem(id) {
    // On supprime aussi ses photos du stockage en ligne, pour ne pas laisser
    // de fichiers orphelins qui occuperaient de la place pour rien.
    const item = items.find((i) => i.id === id);
    if (item) {
      deleteFromStorage(item.photo);
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
          .filter((i) => i.category === categoryView)
          .filter((i) => categorySort !== "favoris" || i.favorite)
          .filter((i) => categorySort !== "jamais" || (i.wornDates || []).length === 0),
        categorySort === "favoris" || categorySort === "jamais" ? "couleur" : categorySort
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
      const hex = await detectDominantColor(item.photo);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, hex } : i)));
    } catch (err) {
      alert("La photo n'a pas pu être analysée. Tu peux choisir la couleur à la main.");
    }
    setDetectingColors(null);
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
          <img src={item.photo} alt={item.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
      { field: "seasons", label: "Saisons", values: SEASONS },
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
                    className="px-2.5 py-1 rounded-full text-xs"
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
  // correspondante dans l'agenda du jour, pour qu'elle apparaisse aussi sur la page Profil.
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
  const [wizardPickerFilter, setWizardPickerFilter] = useState("Tous");
  // Contrôle l'écran de "composition" puis le résultat affiché dans la popup.
  const [wizardGenerating, setWizardGenerating] = useState(false);
  const [wizardShowResult, setWizardShowResult] = useState(false);
  // Retouche de la tenue générée : null = fermé, un nombre = on remplace la pièce
  // à cette position, "add" = on ajoute une pièce.
  const [wizardSwap, setWizardSwap] = useState(null);
  const [wizardAddFilter, setWizardAddFilter] = useState("Tous");

  // Remplace la pièce en position "index" par une autre, ou l'ajoute à la fin.
  function pickWizardItem(itemId) {
    if (wizardSwap === "add") {
      setSelectedIds((prev) => [...prev, itemId]);
    } else {
      setSelectedIds((prev) => prev.map((id, i) => (i === wizardSwap ? itemId : id)));
    }
    setWizardSwap(null);
  }

  function removeWizardItem(index) {
    setSelectedIds((prev) => prev.filter((_, i) => i !== index));
    setWizardSwap(null);
  }

  // Si non-null, le résultat du générateur sera planifié à cette date au lieu
  // d'être simplement ajouté aux tenues (utilisé depuis la popup rapide de Profil).
  const [wizardTargetDate, setWizardTargetDate] = useState(null);

  function openWizard(targetDate) {
    setWizardSwap(null);
    const autoTag = weatherToTag(weather);
    if (autoTag) setCurrentWeather(autoTag);
    setWizardSteps(autoTag
      ? ["piece", "occasion", "couleur", "preference"]
      : ["piece", "meteo", "occasion", "couleur", "preference"]);
    setWizardStep(0);
    setWizardShowResult(false);
    setWizardTargetDate(targetDate || null);
    setShowWizard(true);
  }

  // Traduit la météo réelle (Open-Meteo) en tag : pluie d'abord, sinon selon la
  // température maximale de la journée. Renvoie null si la météo n'est pas disponible.
  function weatherToTag(w) {
    if (!w) return null;
    const rainy = (w.code >= 51 && w.code <= 67) || (w.code >= 80 && w.code <= 82) || w.code >= 95;
    if (rainy) return "Pluie";
    if (w.max >= 22) return "Chaud";
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
  function randomFrom(category, colorAnchor, optional = false) {
    const baseItem = wizardBaseItemId ? items.find((i) => i.id === wizardBaseItemId) : null;
    if (baseItem && baseItem.category === category) return baseItem; // la pièce en tête est toujours incluse

    let pool = items.filter((i) => i.category === category);
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
      const same = pool.filter((i) => hexToColorFamily(i.hex) === genColorFamily);
      const neutral = pool.filter((i) => hexToColorFamily(i.hex) === "Neutres");
      if (same.length > 0) pool = same;
      else if (neutral.length > 0) pool = neutral;
      else if (optional) return undefined;
    } else if (colorAnchor) {
      // Sans choix explicite, on garde la cohérence avec la première pièce colorée :
      // soit la même famille de couleur, soit du neutre.
      const filtered = pool.filter((i) => {
        const fam = hexToColorFamily(i.hex);
        return fam === colorAnchor || fam === "Neutres";
      });
      if (filtered.length > 0) pool = filtered;
      else if (optional) return undefined;
    }

    // Préférence : plutôt des habitués, ou plutôt des vêtements délaissés qu'on "ose" ressortir.
    if (genPreference === "souvent") {
      const sorted = [...pool].sort((a, b) => (b.wornDates || []).length - (a.wornDates || []).length);
      pool = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2))); // la moitié la plus portée
    } else if (genPreference === "oser") {
      const sorted = [...pool].sort((a, b) => (a.wornDates || []).length - (b.wornDates || []).length);
      pool = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2))); // la moitié la moins portée
    }

    return pool[Math.floor(Math.random() * pool.length)];
  }

  function suggestOutfit() {
    const baseItem = wizardBaseItemId ? items.find((i) => i.id === wizardBaseItemId) : null;

    // "L'ancre couleur" : la famille de la première pièce COLORÉE choisie (une pièce
    // neutre va avec tout, elle ne fixe donc pas la palette). Les pièces suivantes sont
    // piochées dans cette même famille ou en neutre.
    let colorAnchor = null;
    function pick(category, optional = false) {
      const item = randomFrom(category, colorAnchor, optional);
      if (item && !colorAnchor && !genColorFamily) {
        const fam = hexToColorFamily(item.hex);
        if (fam !== "Neutres") colorAnchor = fam;
      }
      return item;
    }

    // Niveau de température du jour : "Chaud", "Frais", "Froid", ou null si inconnu.
    // Par temps de pluie, on se base sur la température réelle si on la connaît.
    const rainy = currentWeather === "Pluie";
    let tempLevel = null;
    if (currentWeather === "Chaud" || currentWeather === "Frais" || currentWeather === "Froid") tempLevel = currentWeather;
    else if (weather) tempLevel = weather.max >= 22 ? "Chaud" : weather.max >= 14 ? "Frais" : "Froid";
    // Au-delà de 25 °C, plus de veste ni de chemise par-dessus.
    const tooHot = weather ? weather.max > 25 : false;

    let base;
    let isDress = false;
    if (baseItem && baseItem.category === "Robe") {
      base = [baseItem];
      isDress = true;
      const fam = hexToColorFamily(baseItem.hex);
      if (!genColorFamily && fam !== "Neutres") colorAnchor = fam;
    } else {
      // Une fois sur trois environ, on part sur une robe plutôt que haut + bas séparés
      // (si le dressing en contient au moins une, sinon on retombe sur haut + bas) —
      // sauf si la pièce en tête est justement un haut ou un bas, auquel cas on la respecte.
      const forceTopBottom = baseItem && (baseItem.category === "Haut" || baseItem.category === "Bas");
      const tryDress = !forceTopBottom && Math.random() < 0.33 && items.some((i) => i.category === "Robe");
      isDress = tryDress;
      base = tryDress ? [pick("Robe")] : [pick("Haut"), pick("Bas")];
    }

    const picks = [...base, pick("Chaussures")];
    const forceInclude = (cat) => baseItem && baseItem.category === cat;

    // ── Couche par-dessus le haut (pull OU chemise ouverte), selon la température ──
    //   Plus de 25 °C : aucune · 22-25 °C : parfois une chemise (pas de pull)
    //   Frais : une fois sur deux environ · Froid : un pull
    //   Avec une robe : seulement un pull, et seulement s'il fait froid.
    //   Météo inconnue : une fois sur deux, comme avant.
    let layer = null;
    if (forceInclude("Pull")) layer = "Pull";
    else if (forceInclude("Chemise")) layer = "Chemise";
    else if (isDress) layer = tempLevel === "Froid" ? "Pull" : null;
    else if (tempLevel === "Froid") layer = "Pull";
    else if (tempLevel === "Chaud") layer = !tooHot && Math.random() < 0.5 ? "Chemise" : null;
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
    if (forceInclude("Veste") || rainy || tempLevel === "Froid" || tempLevel === "Frais") wantJacket = true; // toujours sous 22 °C
    else if (tooHot) wantJacket = false;
    else wantJacket = Math.random() < 0.5; // 22-25 °C, ou météo inconnue
    if (wantJacket) picks.push(pick("Veste", !forceInclude("Veste")));

    // ── Accessoire : une fois sur deux, s'il s'accorde aux couleurs ──
    if (forceInclude("Accessoire") || Math.random() > 0.5) picks.push(pick("Accessoire", !forceInclude("Accessoire")));
    const found = picks.filter(Boolean);
    setSelectedIds(found.map((i) => i.id));
    setOutfitName(found.length >= 2 ? nextOutfitName() : "");
    // On pré-coche les tags de la tenue avec les critères utilisés pour la générer.
    setOutfitTags({ seasons: [], weather: currentWeather ? [currentWeather] : [], occasions: genOccasion ? [genOccasion] : [] });
  }

  // Lance la génération avec les critères choisis, puis ferme la popup et ouvre
  // le formulaire de création pour que tu puisses ajuster et enregistrer.
  function wizardGenerate() {
    setWizardSwap(null);
    setWizardGenerating(true);
    setWizardShowResult(false);
    // Petit délai volontaire, juste pour que la génération se "ressente"
    // plutôt que le résultat apparaisse d'un coup sec.
    setTimeout(() => {
      suggestOutfit();
      setWizardGenerating(false);
      setWizardShowResult(true);
    }, 700);
  }

  // Enregistre directement la tenue affichée en résultat, puis referme toute la popup.
  function wizardSaveOutfit() {
    if (wizardTargetDate) {
      planItemsOnDate(wizardTargetDate, selectedIds, outfitName);
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

  const visibleOutfits = outfits
    .filter((o) => !favoritesOnly || o.favorite)
    .filter((o) => outfitSeasonFilter === "Tous" || (o.seasons || []).includes(outfitSeasonFilter))
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
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto`
          );
          const data = await res.json();
          setWeather({
            temp: Math.round(data.current.temperature_2m),
            min: Math.round(data.daily.temperature_2m_min[0]),
            max: Math.round(data.daily.temperature_2m_max[0]),
            code: data.current.weather_code,
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

  // Formate la date du jour pour l'en-tête de la page Profil (ex: "samedi 29 août").
  // Traduit un code météo (norme WMO, utilisée par Open-Meteo) en texte lisible + icône.
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

  // Dégradé de la bannière Profil, fabriqué à partir des couleurs des vêtements
  // prévus aujourd'hui. Corail uni si rien n'est encore planifié.
  function heroGradient() {
    const todayItems = todayEntries.flatMap((e) => e.planItems).filter(Boolean);
    const colors = todayItems.map((i) => i.hex).filter(Boolean).slice(0, 3);
    if (colors.length === 0) return COLORS.rose;
    if (colors.length === 1) return colors[0];
    return `linear-gradient(155deg, ${colors.join(", ")})`;
  }

  function formatTodayHeader() {
    const str = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  // Même principe, mais pour demain — utile pour le petit aperçu sur la page Profil.
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
    const newOutfit = { id: newOutfitId, name: label.trim() || nextOutfitName(), itemIds, favorite: false, wornDates: [], seasons: [], weather: [], occasions: [] };
    setOutfits((prev) => [...prev, newOutfit]);

    if (dateStr && entryId) {
      setAgenda((prev) => ({
        ...prev,
        [dateStr]: normalizeDayEntries(prev[dateStr]).map((e) => (e.id === entryId ? { ...e, outfitId: newOutfitId } : e)),
      }));
    }
  }

  // Retire une tenue précise d'une date (et pas toutes les tenues de ce jour).
  function removeAgendaEntry(dateStr, entryId) {
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
        planItems: entry.itemIds.map((id) => items.find((i) => i.id === id)).filter(Boolean), // au cas où un vêtement aurait été supprimé depuis
      }))
    )
    .filter((entry) => entry.planItems.length > 0)
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
          @import url('https://fonts.googleapis.com/css2?family=Karla:wght@400;500;600;700&family=Merriweather:wght@400;700&display=swap');
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
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Karla:wght@400;500;600;700&family=Merriweather:wght@400;700&display=swap'); * { font-family: 'Karla', sans-serif; }`}</style>
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
    <div style={{ background: COLORS.ivory, minHeight: "100vh", color: COLORS.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Karla:wght@400;500;600;700&family=Merriweather:wght@400;700&display=swap');
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
        {/* ── EN-TÊTE — uniquement sur la page Profil ── */}
        {view === "accueil" && (
          <div className="-mx-5 -mt-10 mb-6" style={{ position: "relative", overflow: "hidden", borderRadius: "0 0 28px 28px", background: heroGradient() }}>
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.48) 100%)" }} />
            <div style={{ position: "relative", padding: "44px 20px 28px 20px" }}>
              {weatherStatus === "granted" && weather ? (
                <p className="text-sm" style={{ color: "rgba(255,255,255,0.85)" }}>{formatTodayHeader()} · {weather.temp}°</p>
              ) : (
                <p className="text-sm" style={{ color: "rgba(255,255,255,0.85)" }}>{formatTodayHeader()}</p>
              )}
              <h1 className="display" style={{ fontWeight: 700, fontSize: 30, color: "#ffffff", marginTop: 6, lineHeight: 1.1 }}>{getGreeting(userName)}</h1>
              {(weatherStatus === "denied" || weatherStatus === "error") && (
                <button onClick={requestWeather} className="text-xs mt-2" style={{ color: "#ffffff", textDecoration: "underline" }}>
                  Activer la météo
                </button>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════ VUE ACCUEIL ══════════════════ */}
        {view === "accueil" && (
          <div key={view} className={slideDir === "right" ? "slide-right" : "slide-left"}>
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <p className="display" style={{ fontWeight: 700, fontSize: 16 }}>Pour aujourd'hui</p>
                <button
                  type="button"
                  onClick={() => openQuickPlan(todayKey())}
                  aria-label={todayEntries.length > 0 ? "Ajouter une autre tenue pour aujourd'hui" : "Planifier une tenue pour aujourd'hui"}
                  className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: COLORS.haze, color: COLORS.ink }}
                >
                  <Plus size={14} />
                </button>
              </div>

              {todayEntries.map((entry) => {
                const validated = isPlanValidatedToday(entry.planItems);
                return (
                  <div key={entry.entryId} onClick={() => setOpenEntryId(entry.entryId)} className="relative mb-5 cursor-pointer">
                    <div className="flex items-center pr-8 mb-2">
                      <p className="text-sm font-medium" style={{ color: COLORS.rose }}>
                        {entry.label}{validated ? " ✓" : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); askConfirm("Supprimer cette tenue prévue ?", () => removeAgendaEntry(entry.dateStr, entry.entryId)); }}
                      className="absolute top-0 right-0 w-6 h-6 rounded-full flex items-center justify-center"
                      style={{ background: "rgba(0,0,0,0.06)" }}
                    >
                      <X size={13} />
                    </button>
                    <div className="grid grid-cols-3 gap-2">
                      {entry.planItems.map((item) => (
                        <div key={item.id} className="rounded-xl overflow-hidden" style={{ background: COLORS.haze }}>
                          {item.photo ? (
                            <img src={item.photo} alt={item.name} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
                          ) : (
                            <div style={{ background: item.hex, aspectRatio: "1 / 1" }} />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Stats, en ligne, séparées par un simple trait ── */}
            <div className="flex items-end gap-7 pb-5 mb-6" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
              <button type="button" onClick={() => changeView("dressing")} className="text-left">
                <p className="display" style={{ fontWeight: 700, fontSize: 26, lineHeight: 1 }}>{items.length}</p>
                <p className="text-xs mt-1" style={{ color: COLORS.muted }}>vêtement{items.length > 1 ? "s" : ""}</p>
              </button>
              <button type="button" onClick={() => changeView("tenues")} className="text-left">
                <p className="display" style={{ fontWeight: 700, fontSize: 26, lineHeight: 1 }}>{outfits.length}</p>
                <p className="text-xs mt-1" style={{ color: COLORS.muted }}>tenue{outfits.length > 1 ? "s" : ""}</p>
              </button>
              <div className="text-left">
                <p className="display" style={{ fontWeight: 700, fontSize: 26, lineHeight: 1, color: COLORS.rose }}>{favoriteItemsCount}</p>
                <p className="text-xs mt-1" style={{ color: COLORS.muted }}>favori{favoriteItemsCount > 1 ? "s" : ""}</p>
              </div>
            </div>

            {/* ── Et demain ? ── */}
            {tomorrowEntries.length === 0 ? (
              <button
                type="button"
                onClick={() => openQuickPlan(tomorrowKey())}
                className="w-full flex items-center justify-between p-4 rounded-2xl text-left mb-6"
                style={{ background: COLORS.haze }}
              >
                <div>
                  <p className="display" style={{ fontWeight: 700, fontSize: 16 }}>Et demain ?</p>
                  <p className="text-xs mt-0.5" style={{ color: COLORS.muted }}>Rien de prévu</p>
                </div>
                <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: COLORS.ink }}>
                  <Plus size={16} color="#ffffff" />
                </span>
              </button>
            ) : (
              <div className="p-4 rounded-2xl mb-6" style={{ background: COLORS.haze }}>
                <div className="flex items-center justify-between mb-3">
                  <p className="display" style={{ fontWeight: 700, fontSize: 16 }}>Et demain ?</p>
                  <button
                    type="button"
                    onClick={() => openQuickPlan(tomorrowKey())}
                    aria-label="Ajouter une tenue pour demain"
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: COLORS.ivory, color: COLORS.ink }}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                {tomorrowEntries.map((entry) => (
                  <div key={entry.entryId} className="mb-3">
                    <p className="text-xs font-medium mb-2" style={{ color: COLORS.rose }}>{entry.label}</p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {entry.planItems.map((item) => (
                        <div key={item.id} className="rounded-lg overflow-hidden" style={{ background: COLORS.ivory }}>
                          {item.photo ? (
                            <img src={item.photo} alt={item.name} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
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
                  className="fixed inset-0 flex items-center justify-center p-5"
                  style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}
                >
                  {/* stopPropagation : un clic à l'intérieur de la popup ne doit pas la fermer */}
                  <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-lg p-5" style={{ background: "#FFFFFF", maxHeight: "85vh", overflowY: "auto" }}>
                    <div className="flex items-center justify-between mb-4">
                      <p className="display text-lg" style={{ fontWeight: 600 }}>{entry.label}</p>
                      <button onClick={() => setOpenEntryId(null)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.06)" }}>
                        <X size={14} />
                      </button>
                    </div>

                    <div className="space-y-2 mb-3">
                      {entry.planItems.map((item) => (
                        <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg" style={{ background: COLORS.ivory }}>
                          <div className="rounded overflow-hidden" style={{ background: item.hex, width: 40, height: 40, border: `1px solid ${COLORS.line}` }}>
                            {item.photo && <img src={item.photo} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium">{item.name}</p>
                            <p className="text-xs" style={{ color: COLORS.muted }}>{item.category}</p>
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
                        <select
                          value={modalPickerFilter}
                          onChange={(e) => setModalPickerFilter(e.target.value)}
                          className="px-3 py-1.5 rounded-full text-xs mb-2"
                          style={{ border: `1px solid ${COLORS.line}`, background: COLORS.card }}
                        >
                          <option value="Tous">Toutes catégories</option>
                          {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                        <div className="grid grid-cols-4 gap-2">
                          {items
                            .filter((item) => !entry.planItems.some((p) => p.id === item.id)) // déjà dans la tenue → pas la peine de le reproposer
                            .filter((item) => modalPickerFilter === "Tous" || item.category === modalPickerFilter)
                            .map((item) => (
                              <button
                                type="button"
                                key={item.id}
                                onClick={() => addItemToEntry(entry.dateStr, entry.entryId, item.id)}
                                className="rounded-lg overflow-hidden text-left"
                                style={{ border: `1px solid ${COLORS.line}` }}
                              >
                                <div style={{ background: item.hex, aspectRatio: "1 / 1", overflow: "hidden" }}>
                                  {item.photo && <img src={item.photo} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                                </div>
                              </button>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Si cette tenue n'est pas encore dans la collection réutilisable, on propose de l'y ajouter */}
                    {!entry.outfitId && (
                      <button
                        type="button"
                        onClick={() => saveAsReusableOutfit(entry.planItems.map((i) => i.id), entry.label, entry.dateStr, entry.entryId)}
                        className="flex items-center gap-1.5 text-xs mb-3"
                        style={{ color: COLORS.ink, opacity: 0.6 }}
                      >
                        <Plus size={13} /> Ajouter à ma collection de tenues
                      </button>
                    )}

                    <button
                      onClick={() => { validateTodayPlan(entry); setOpenEntryId(null); }}
                      disabled={validated}
                      className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm"
                      style={{ background: COLORS.rose, color: "white" }}
                    >
                      {validated ? "Tenue validée ✓" : "Oui, je porte cette tenue aujourd'hui"}
                    </button>

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
                  <h1 className="display text-3xl" style={{ fontWeight: 600 }}>Garde-robe</h1>
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
                <h1 className="display text-3xl" style={{ fontWeight: 600 }}>{CATEGORY_PLURALS[categoryView] || categoryView}</h1>
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
                className="fixed inset-0 flex items-center justify-center p-5"
                style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}
              >
                <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-lg p-5" style={{ background: "#FFFFFF", maxHeight: "85vh", overflowY: "auto" }}>
                  <div className="flex items-center justify-between mb-4">
                    <p className="display text-lg" style={{ fontWeight: 600 }}>Ajouter un vêtement</p>
                    <button onClick={() => setShowAddForm(false)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.06)" }}>
                      <X size={14} />
                    </button>
                  </div>
                  <form onSubmit={(e) => { addItem(e); setShowAddForm(false); }} className="flex flex-wrap gap-3 items-end">
                    <div className="flex-1 min-w-[140px]">
                      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nom du vêtement" className="w-full px-3 py-2 rounded text-sm" style={{ border: `1px solid ${COLORS.line}`, outline: "none" }} />
                    </div>
                    <div>
                      <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="px-3 py-2 rounded text-sm" style={{ border: `1px solid ${COLORS.line}` }}>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="flex items-center justify-center rounded cursor-pointer overflow-hidden" style={{ width: 40, height: 36, border: `1px solid ${COLORS.line}`, background: form.photo ? "transparent" : "#FAFAFA" }}>
                        {form.photo ? <img src={form.photo} alt="Aperçu" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Camera size={15} style={{ opacity: 0.4 }} />}
                        <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
                      </label>
                    </div>
                    <div>
                      <input type="color" value={form.hex} onChange={(e) => setForm({ ...form, hex: e.target.value })} className="w-10 h-9 rounded cursor-pointer" style={{ border: `1px solid ${COLORS.line}` }} />
                    </div>
                    <div className="w-full">
                      <div className="flex gap-1.5 flex-wrap">
                        {WEATHER_TAGS.map((w) => (
                          <button type="button" key={w} onClick={() => toggleFormWeather(w)} className="px-2.5 py-1 rounded-full text-xs" style={{
                            background: form.weather.includes(w) ? COLORS.rose : "transparent",
                            color: form.weather.includes(w) ? "white" : COLORS.ink,
                            border: `1px solid ${form.weather.includes(w) ? COLORS.rose : COLORS.line}`,
                          }}>
                            {w}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="w-full">
                      <div className="flex gap-1.5 flex-wrap">
                        {OCCASIONS.map((o) => (
                          <button type="button" key={o} onClick={() => toggleFormOccasion(o)} className="px-2.5 py-1 rounded-full text-xs" style={{
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
                  {CATEGORY_SORTS.map((s) => {
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
                    {categorySort === "favoris" ? "Aucun favori" : categorySort === "jamais" ? "Tout a déjà été porté ✓" : "Vide"}
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
            <button onClick={() => setDetailItemId(null)} className="flex items-center gap-1.5 text-sm mb-4" style={{ opacity: 0.6 }}>
              <ArrowLeft size={18} />
            </button>

            <div className="rounded-lg overflow-hidden mb-4 relative" style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }}>
              {detailItem.photo ? (
                <img src={detailItem.photo} alt={detailItem.name} style={{ width: "100%", height: 200, objectFit: "cover" }} />
              ) : (
                <div style={{ background: detailItem.hex, height: 200 }} />
              )}
              <div className="absolute top-2 right-2 flex gap-1.5">
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
                <p className="display text-xl" style={{ fontWeight: 600 }}>{detailItem.name}</p>
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
                      className="px-2.5 py-1 rounded-full text-xs"
                      style={{
                        background: active ? COLORS.ink : "transparent",
                        color: active ? "white" : COLORS.ink,
                        border: `1px solid ${active ? COLORS.ink : COLORS.line}`,
                      }}
                    >
                      {c}
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
                  onChange={(e) => setItems((prev) => prev.map((i) => i.id === detailItem.id ? { ...i, hex: e.target.value } : i))}
                  className="w-12 h-9 rounded cursor-pointer"
                  style={{ border: `1px solid ${COLORS.line}` }}
                />
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
                      className="px-2.5 py-1 rounded-full text-xs" style={{
                        background: active ? COLORS.rose : "transparent",
                        color: active ? "white" : COLORS.ink,
                        border: `1px solid ${active ? COLORS.rose : COLORS.line}`,
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
                      className="px-2.5 py-1 rounded-full text-xs" style={{
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
                  onClick={() => { setPairsPickerFilter("Tous"); setShowPairsModal(true); }}
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
                          {other.photo && <img src={other.photo} alt={other.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
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
                className="fixed inset-0 flex items-center justify-center p-5"
                style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}
              >
                <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-lg p-5" style={{ background: "#FFFFFF", maxHeight: "85vh", overflowY: "auto" }}>
                  <div className="flex items-center justify-between mb-4">
                    <p className="display text-lg" style={{ fontWeight: 600 }}>Va bien avec</p>
                    <button onClick={() => setShowPairsModal(false)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.06)" }}>
                      <X size={14} />
                    </button>
                  </div>

                  <select
                    value={pairsPickerFilter}
                    onChange={(e) => setPairsPickerFilter(e.target.value)}
                    className="px-3 py-1.5 rounded-full text-xs mb-3"
                    style={{ border: `1px solid ${COLORS.line}`, background: COLORS.card }}
                  >
                    <option value="Tous">Toutes catégories</option>
                    {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                  </select>

                  <div className="grid grid-cols-3 gap-2">
                    {items
                      .filter((i) => i.id !== detailItem.id)
                      .filter((i) => pairsPickerFilter === "Tous" || i.category === pairsPickerFilter)
                      .map((other) => {
                        const linked = (detailItem.pairsWith || []).includes(other.id);
                        return (
                          <button key={other.id} onClick={() => togglePair(detailItem.id, other.id)} className="rounded-lg overflow-hidden text-left" style={{ border: `2px solid ${linked ? COLORS.rose : COLORS.line}`, opacity: linked ? 1 : 0.7 }}>
                            <div style={{ background: other.hex, aspectRatio: "1 / 1", overflow: "hidden" }}>
                              {other.photo && <img src={other.photo} alt={other.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                            </div>
                          </button>
                        );
                      })}
                  </div>
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
                className="w-full px-3 py-2 rounded text-sm"
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

            <button onClick={() => askConfirm("Supprimer ce vêtement ?", () => removeItem(detailItem.id))} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs" style={{ border: "1px solid #C4808C", color: "#C4808C" }}>
              <X size={13} /> Supprimer
            </button>
          </div>
        )}

        {/* ══════════════════ VUE TENUES ══════════════════ */}
        {view === "tenues" && (
          <div key={view} className={slideDir === "right" ? "slide-right" : "slide-left"}>
            <div className="flex items-end justify-between mb-6">
              <div>
                <h1 className="display text-3xl" style={{ fontWeight: 700 }}>Tenues</h1>
                <p className="text-sm mt-1" style={{ color: COLORS.muted }}>{outfits.length} tenue{outfits.length > 1 ? "s" : ""}</p>
              </div>
              <button
                type="button"
                onClick={() => openWizard()}
                aria-label="Générer une tenue"
                className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center"
                style={{ color: COLORS.gold }}
              >
                <Sparkles size={20} />
              </button>
            </div>

            <button
              type="button"
              onClick={() => { setCreateOutfitStep("select"); setOutfitTags(EMPTY_OUTFIT_TAGS); setOutfitName(nextOutfitName()); setShowOutfitForm(true); }}
              aria-label="Créer une tenue"
              className="flex items-center justify-center rounded-full text-white"
              style={{ position: "fixed", right: 20, bottom: 84, width: 56, height: 56, background: COLORS.rose, boxShadow: "0 6px 18px rgba(255,75,51,0.35)", zIndex: 30 }}
            >
              <Plus size={24} />
            </button>

            {showOutfitForm && (
              <div
                onClick={() => setShowOutfitForm(false)}
                className="fixed inset-0 flex items-center justify-center p-5"
                style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}
              >
                <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-lg p-5" style={{ background: "#FFFFFF", maxHeight: "85vh", overflowY: "auto" }}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="display text-lg" style={{ fontWeight: 600 }}>Créer une tenue</p>
                    <button onClick={() => setShowOutfitForm(false)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.06)" }}>
                      <X size={14} />
                    </button>
                  </div>
                  <form onSubmit={saveOutfit}>
                    {createOutfitStep === "select" && (
                      <>

                        <select
                          value={outfitPickerFilter}
                          onChange={(e) => setOutfitPickerFilter(e.target.value)}
                          className="px-3 py-1.5 rounded-full text-xs mb-2"
                          style={{ border: `1px solid ${COLORS.line}`, background: COLORS.card }}
                        >
                          <option value="Tous">Toutes catégories</option>
                          {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                        <div className="grid grid-cols-3 gap-2 mb-4">
                          {items
                            .filter((item) => outfitPickerFilter === "Tous" || item.category === outfitPickerFilter)
                            .map((item) => {
                            const isSelected = selectedIds.includes(item.id);
                            return (
                              <button type="button" key={item.id} onClick={() => toggleSelected(item.id)} className="rounded-lg overflow-hidden text-left" style={{ border: `2px solid ${isSelected ? COLORS.rose : COLORS.line}`, opacity: isSelected ? 1 : 0.7 }}>
                                <div style={{ background: item.hex, aspectRatio: "1 / 1", overflow: "hidden" }}>
                                  {item.photo && <img src={item.photo} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        <button
                          type="button"
                          onClick={() => setCreateOutfitStep("summary")}
                          disabled={selectedIds.length === 0}
                          className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm text-white"
                          style={{ background: COLORS.rose, opacity: selectedIds.length === 0 ? 0.4 : 1 }}
                        >
                          Suivant
                        </button>
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
                                  <img src={item.photo} alt={item.name} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
                                ) : (
                                  <div style={{ background: item.hex, aspectRatio: "1 / 1" }} />
                                )}
                              </div>
                            );
                          })}
                        </div>

                        <input value={outfitName} onChange={(e) => setOutfitName(e.target.value)} placeholder="Nom de la tenue" className="w-full px-3 py-2 rounded text-sm mb-3" style={{ border: `1px solid ${COLORS.line}`, outline: "none" }} />

                        {renderOutfitTagPicker()}

                        <button type="submit" disabled={!outfitName.trim() || selectedIds.length === 0} className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm text-white" style={{ background: COLORS.rose, opacity: !outfitName.trim() || selectedIds.length === 0 ? 0.4 : 1 }}>
                          <Plus size={16} /> Enregistrer la tenue
                        </button>
                      </>
                    )}
                  </form>
                </div>
              </div>
            )}

            {!detailOutfitId && (
            <>
            <div data-no-swipe className="no-scrollbar -mx-5 px-5 flex gap-2 overflow-x-auto mb-5">
              <button onClick={() => setFavoritesOnly((v) => !v)} className="flex-shrink-0 flex items-center gap-1.5 px-4 rounded-full text-sm" style={{
                height: 36,
                background: favoritesOnly ? COLORS.ink : "transparent",
                color: favoritesOnly ? "white" : COLORS.ink,
                border: `1px solid ${favoritesOnly ? COLORS.ink : COLORS.line}`,
              }}>
                <Heart size={13} fill={favoritesOnly ? "white" : "none"} /> Favoris
              </button>

              <select
                value={outfitSeasonFilter}
                onChange={(e) => setOutfitSeasonFilter(e.target.value)}
                className="flex-shrink-0 px-4 rounded-full text-sm"
                style={{ height: 36, border: `1px solid ${COLORS.line}`, background: "transparent" }}
              >
                <option value="Tous">Toutes saisons</option>
                {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>

              <select
                value={outfitWeatherFilter}
                onChange={(e) => setOutfitWeatherFilter(e.target.value)}
                className="flex-shrink-0 px-4 rounded-full text-sm"
                style={{ height: 36, border: `1px solid ${COLORS.line}`, background: "transparent" }}
              >
                <option value="Tous">Toute météo</option>
                {WEATHER_TAGS.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>

              <select
                value={outfitOccasionFilter}
                onChange={(e) => setOutfitOccasionFilter(e.target.value)}
                className="flex-shrink-0 px-4 rounded-full text-sm"
                style={{ height: 36, border: `1px solid ${COLORS.line}`, background: "transparent" }}
              >
                <option value="Tous">Toutes occasions</option>
                {OCCASIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            {visibleOutfits.length === 0 ? (
              <p className="text-sm py-10 text-center" style={{ color: COLORS.muted }}>
                {favoritesOnly ? "Aucun favori" : "Aucune tenue"}
              </p>
            ) : (
              <div>
                {visibleOutfits.map((outfit) => (
                  <div key={outfit.id} onClick={() => setDetailOutfitId(outfit.id)} className="relative mb-7 cursor-pointer">
                    <div className="flex items-center pr-16 mb-2">
                      <p className="text-sm font-medium" style={{ color: COLORS.rose }}>{outfit.name}</p>
                    </div>
                    <div className="absolute top-0 right-0 flex gap-1">
                      <button onClick={(e) => { e.stopPropagation(); toggleFavoriteOutfit(outfit.id); }} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                        <Heart size={13} color={outfit.favorite ? COLORS.rose : COLORS.ink} fill={outfit.favorite ? COLORS.rose : "none"} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); askConfirm("Supprimer cette tenue ?", () => removeOutfit(outfit.id)); }} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: COLORS.haze }}>
                        <X size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-3">
                      {itemsForOutfit(outfit).map((item) => (
                        <div key={item.id} className="rounded-xl overflow-hidden" style={{ background: COLORS.haze }}>
                          {item.photo ? (
                            <img src={item.photo} alt={item.name} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
                          ) : (
                            <div style={{ background: item.hex, aspectRatio: "1 / 1" }} />
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <p className="text-xs" style={{ color: COLORS.muted }}>
                        {(outfit.wornDates || []).length === 0 ? "Jamais portée" : `Portée ${(outfit.wornDates || []).length}x · dernière : ${formatDate(outfit.wornDates[outfit.wornDates.length - 1])}`}
                      </p>
                      <button
                        onClick={(e) => { e.stopPropagation(); isWornToday(outfit) ? unmarkOutfitWorn(outfit) : markOutfitWorn(outfit); }}
                        className="text-xs px-3 py-1.5 rounded-full flex-shrink-0"
                        style={
                          isWornToday(outfit)
                            ? { background: COLORS.rose, color: "white" }
                            : { border: `1px solid ${COLORS.gold}`, color: COLORS.gold }
                        }
                      >
                        {isWornToday(outfit) ? "Portée aujourd'hui ✓" : "Portée aujourd'hui"}
                      </button>
                    </div>
                  </div>
                ))}
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
                  <button onClick={() => setDetailOutfitId(null)} className="flex items-center gap-1.5 text-sm mb-4" style={{ opacity: 0.6 }}>
                    <ArrowLeft size={15} /> Retour aux tenues
                  </button>

                  <div className="flex items-center justify-between mb-3">
                    <p className="display text-xl" style={{ fontWeight: 600 }}>{outfit.name}</p>
                    <div className="flex gap-1">
                      <button onClick={() => toggleFavoriteOutfit(outfit.id)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.06)" }}>
                        <Heart size={15} color={outfit.favorite ? COLORS.rose : COLORS.ink} fill={outfit.favorite ? COLORS.rose : "none"} />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-5">
                    {itemsForOutfit(outfit).map((item) => (
                      <div key={item.id} className="rounded-xl overflow-hidden" style={{ background: COLORS.haze }}>
                        {item.photo ? (
                          <img src={item.photo} alt={item.name} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
                        ) : (
                          <div style={{ background: item.hex, aspectRatio: "1 / 1" }} />
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Saisons */}
                  <div className="mb-5">
                    <div className="flex gap-1.5 flex-wrap">
                      {SEASONS.map((s) => {
                        const active = (outfit.seasons || []).includes(s);
                        return (
                          <button key={s} onClick={() => setOutfits((prev) => prev.map((o) => o.id === outfit.id ? { ...o, seasons: active ? (o.seasons || []).filter((x) => x !== s) : [...(o.seasons || []), s] } : o))}
                            className="px-2.5 py-1 rounded-full text-xs" style={{
                              background: active ? COLORS.sage : "transparent",
                              color: active ? "white" : COLORS.ink,
                              border: `1px solid ${active ? COLORS.sage : COLORS.line}`,
                            }}>
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Météo */}
                  <div className="mb-5">
                    <div className="flex gap-1.5 flex-wrap">
                      {WEATHER_TAGS.map((w) => {
                        const active = (outfit.weather || []).includes(w);
                        return (
                          <button key={w} onClick={() => setOutfits((prev) => prev.map((o) => o.id === outfit.id ? { ...o, weather: active ? (o.weather || []).filter((x) => x !== w) : [...(o.weather || []), w] } : o))}
                            className="px-2.5 py-1 rounded-full text-xs" style={{
                              background: active ? COLORS.rose : "transparent",
                              color: active ? "white" : COLORS.ink,
                              border: `1px solid ${active ? COLORS.rose : COLORS.line}`,
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
                            className="px-2.5 py-1 rounded-full text-xs" style={{
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
                    <button onClick={() => askConfirm("Supprimer cette tenue ?", () => { removeOutfit(outfit.id); setDetailOutfitId(null); })} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs" style={{ border: "1px solid #C4808C", color: "#C4808C" }}>
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
            <h1 className="display text-3xl mb-6" style={{ fontWeight: 700 }}>Agenda</h1>

            {items.length === 0 && (
              <p className="text-sm mb-5" style={{ color: COLORS.muted }}>Ajoute d'abord des vêtements.</p>
            )}

            {items.length > 0 && (
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

            {/* ── Une rangée par mois, qui défile sur le côté (comme la Garde-robe) ── */}
            <div className="flex flex-col gap-7">
              {agendaMonthGroups.map((group) => (
                <section key={group.key}>
                  <h2 className="text-base mb-3" style={{ fontWeight: 600 }}>
                    {formatMonthLabel(group.key)}{" "}
                    <span style={{ fontWeight: 400, color: COLORS.muted }}>· {group.entries.length}</span>
                  </h2>
                  <div data-no-swipe className="no-scrollbar -mx-5 px-5 flex gap-2.5 overflow-x-auto">
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
                            {shown.map((item) => (
                              item.photo ? (
                                <img key={item.id} src={item.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
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
                </section>
              ))}
            </div>

            {/* ── Popup "jour" : détail d'une date cliquée dans le calendrier, avec glissement entre jours ── */}
            {dayViewDate && (() => {
              const dayEntries = agendaEntries.filter((e) => e.dateStr === dayViewDate);
              return (
                <div
                  onClick={() => setDayViewDate(null)}
                  className="fixed inset-0 flex items-center justify-center p-5"
                  style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}
                >
                  <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-lg p-5" style={{ background: "#FFFFFF", maxHeight: "85vh", overflowY: "auto" }}>
                    <div className="flex items-center justify-between mb-4">
                      <button onClick={() => setDayViewDate(shiftDateKey(dayViewDate, -1))} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.06)" }}>
                        <ArrowLeft size={15} />
                      </button>
                      <p className="text-sm font-medium text-center" style={{ flex: 1 }}>
                        {dayViewDate === todayKey() ? "Aujourd'hui" : formatAgendaDate(dayViewDate)}
                      </p>
                      <button onClick={() => setDayViewDate(shiftDateKey(dayViewDate, 1))} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.06)" }}>
                        <ArrowLeft size={15} style={{ transform: "rotate(180deg)" }} />
                      </button>
                    </div>

                    {dayEntries.length === 0 ? (
                      <p className="text-xs py-4 text-center" style={{ opacity: 0.5 }}>Rien de prévu</p>
                    ) : (
                      <div className="space-y-3 mb-4">
                        {dayEntries.map((entry) => (
                          <div key={entry.entryId}>
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-medium" style={{ color: COLORS.rose }}>{entry.label}</p>
                              <button
                                type="button"
                                onClick={() => askConfirm("Supprimer cette tenue prévue ?", () => removeAgendaEntry(entry.dateStr, entry.entryId))}
                                aria-label="Supprimer cette tenue prévue"
                                className="w-7 h-7 rounded-full flex items-center justify-center"
                                style={{ background: COLORS.haze }}
                              >
                                <X size={13} />
                              </button>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              {entry.planItems.map((item) => (
                                <div key={item.id} className="rounded-xl overflow-hidden" style={{ background: COLORS.haze }}>
                                  {item.photo ? (
                                    <img src={item.photo} alt={item.name} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
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
                    <X size={18} color="#C4808C" />
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
                      style={{ background: "#C4808C" }}
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
                  className="fixed inset-0 flex items-center justify-center p-5"
                  style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}
                >
                  <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-lg p-5" style={{ background: "#FFFFFF", maxHeight: "85vh", overflowY: "auto" }}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="display text-lg" style={{ fontWeight: 600 }}>Suggère-moi une tenue</p>
                      <button onClick={() => setShowWizard(false)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.06)" }}>
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
                                    <img src={item.photo} alt={item.name} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
                                  ) : (
                                    <div style={{ background: item.hex, aspectRatio: "1 / 1" }} />
                                  )}
                                </button>
                              ))}
                            </div>
                          )}

                          {current && (
                            <button type="button" onClick={() => removeWizardItem(wizardSwap)} className="w-full px-4 py-2 rounded-full text-sm" style={{ border: "1px solid #C4808C", color: "#C4808C" }}>
                              Retirer cette pièce
                            </button>
                          )}
                        </div>
                      );
                    })()}

                    {!wizardGenerating && wizardShowResult && wizardSwap === null && (
                      <div className="mb-4">
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
                                    <img src={item.photo} alt={item.name} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
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

                        <input
                          value={outfitName}
                          onChange={(e) => setOutfitName(e.target.value)}
                          placeholder="Nom de la tenue"
                          className="w-full px-3 py-2 rounded text-sm mb-3"
                          style={{ border: `1px solid ${COLORS.line}`, outline: "none" }}
                        />

                        {!wizardTargetDate && renderOutfitTagPicker()}

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
                            {wizardTargetDate ? `Planifier pour ${wizardTargetDate === todayKey() ? "aujourd'hui" : "demain"}` : "Ajouter à mes tenues"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ── Questions, une étape à la fois ── */}
                    {!wizardGenerating && !wizardShowResult && (
                      <>
                    {step === "piece" && !WIZARD_STEPS.includes("meteo") && currentWeather && weather && (
                      <p className="text-xs mb-3 px-3 py-2 rounded-full inline-flex items-center gap-1.5" style={{ background: "#F3F2EF" }}>
                        <Sun size={13} /> {currentWeather} · {weather.min}° / {weather.max}°
                      </p>
                    )}
                    {step === "piece" && (
                      <div className="mb-4">
                        <p className="text-sm font-medium mb-3">Une pièce en tête ?</p>
                        <select
                          value={wizardPickerFilter}
                          onChange={(e) => setWizardPickerFilter(e.target.value)}
                          className="px-3 py-1.5 rounded-full text-xs mb-2"
                          style={{ border: `1px solid ${COLORS.line}`, background: COLORS.card }}
                        >
                          <option value="Tous">Toutes catégories</option>
                          {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                        <div className="grid grid-cols-3 gap-2">
                          {items
                            .filter((item) => wizardPickerFilter === "Tous" || item.category === wizardPickerFilter)
                            .map((item) => {
                              const active = wizardBaseItemId === item.id;
                              return (
                                <button
                                  type="button"
                                  key={item.id}
                                  onClick={() => setWizardBaseItemId(active ? null : item.id)}
                                  className="rounded-lg overflow-hidden text-left"
                                  style={{ border: `2px solid ${active ? COLORS.rose : COLORS.line}`, opacity: active ? 1 : 0.75 }}
                                >
                                  <div style={{ background: item.hex, aspectRatio: "1 / 1", overflow: "hidden" }}>
                                    {item.photo && <img src={item.photo} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                                  </div>
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    )}

                    {step === "meteo" && (
                      <div className="mb-4">
                        <p className="text-sm font-medium mb-3">Il fait quel temps aujourd'hui ?</p>
                        <div className="flex gap-1.5 flex-wrap">
                          {WEATHER_TAGS.map((w) => {
                            const active = currentWeather === w;
                            return (
                              <button type="button" key={w} onClick={() => setCurrentWeather(active ? null : w)} className="px-3 py-1.5 rounded-full text-sm" style={{
                                background: active ? COLORS.rose : "transparent",
                                color: active ? "white" : COLORS.ink,
                                border: `1px solid ${active ? COLORS.rose : COLORS.line}`,
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
                              <button type="button" key={o} onClick={() => setGenOccasion(active ? null : o)} className="px-3 py-1.5 rounded-full text-sm" style={{
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
                        <div className="flex flex-col gap-2">
                          {COLOR_FAMILIES.map((c) => {
                            const active = genColorFamily === c;
                            // Les vêtements de cette famille, et un aperçu de leurs vraies couleurs.
                            const familyItems = items.filter((i) => hexToColorFamily(i.hex) === c);
                            const count = familyItems.length;
                            const swatches = [...new Set([...familyItems].sort(compareByColor).map((i) => (i.hex || "").toLowerCase()))].filter(Boolean).slice(0, 5);
                            const empty = count === 0;
                            return (
                              <button
                                type="button"
                                key={c}
                                disabled={empty}
                                onClick={() => setGenColorFamily(active ? null : c)}
                                className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-2xl text-left"
                                style={{
                                  border: active ? `2px solid ${COLORS.ink}` : empty ? "1px dashed #DDDDDD" : `1px solid ${COLORS.line}`,
                                  opacity: empty ? 0.5 : 1,
                                  background: "#FFFFFF",
                                }}
                              >
                                <span className="flex flex-col">
                                  <span className="text-sm" style={{ fontWeight: 600 }}>{c}</span>
                                  <span className="text-xs" style={{ color: COLORS.muted }}>{count} pièce{count > 1 ? "s" : ""}</span>
                                </span>
                                <span className="flex items-center gap-2.5">
                                  {empty ? (
                                    <span className="text-xs" style={{ color: "#B5B5B5" }}>aucune pièce</span>
                                  ) : (
                                    <span className="flex" style={{ paddingLeft: 6 }}>
                                      {swatches.map((hex) => (
                                        <span
                                          key={hex}
                                          style={{ width: 22, height: 22, borderRadius: 6, background: hex, border: "1px solid rgba(0,0,0,0.08)", marginLeft: -6, boxShadow: "0 0 0 2px #FFFFFF" }}
                                        />
                                      ))}
                                    </span>
                                  )}
                                  {active && (
                                    <span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: COLORS.ink }}>
                                      <Check size={12} color="#FFFFFF" strokeWidth={3} />
                                    </span>
                                  )}
                                </span>
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
                              <button type="button" key={key} onClick={() => setGenPreference(active ? null : key)} className="px-3 py-1.5 rounded-full text-sm" style={{
                                background: active ? COLORS.gold : "transparent",
                                color: active ? "white" : COLORS.ink,
                                border: `1px solid ${active ? COLORS.gold : COLORS.line}`,
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
                className="fixed inset-0 flex items-center justify-center p-5"
                style={{ background: "rgba(0,0,0,0.6)", zIndex: 60 }}
              >
                <div className="w-full max-w-sm rounded-lg p-5" style={{ background: "#FFFFFF" }}>
                  <div className="flex items-center justify-between mb-4">
                    <p className="display text-lg" style={{ fontWeight: 600 }}>Recadrer la photo</p>
                    <button onClick={() => { setShowCropModal(false); setRawImageSrc(null); }} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.06)" }}>
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
                className="fixed inset-0 flex items-center justify-center p-5"
                style={{ background: "rgba(0,0,0,0.4)", zIndex: 50 }}
              >
                <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-lg p-5" style={{ background: "#FFFFFF", maxHeight: "85vh", overflowY: "auto" }}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      {quickPlanMode !== "choice" && (
                        <button onClick={() => setQuickPlanMode("choice")} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.06)" }}>
                          <ArrowLeft size={14} />
                        </button>
                      )}
                      <p className="display text-lg" style={{ fontWeight: 600 }}>
                        {planDate === todayKey() ? "Tenue pour aujourd'hui" : planDate === tomorrowKey() ? "Tenue pour demain" : "Planifier une tenue"}
                      </p>
                    </div>
                    <button onClick={() => setShowQuickPlanModal(false)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.06)" }}>
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
                        className="px-3 py-2 rounded text-sm"
                        style={{ border: `1px solid ${COLORS.line}` }}
                      />
                    </div>
                  )}

                  {/* Étape 1 : comment veux-tu procéder ? */}
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
                          value={outfitSeasonFilter}
                          onChange={(e) => setOutfitSeasonFilter(e.target.value)}
                          className="px-2.5 py-1 rounded-full text-[11px]"
                          style={{ border: `1px solid ${COLORS.line}`, background: COLORS.card }}
                        >
                          <option value="Tous">Toutes saisons</option>
                          {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
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
                          .filter((o) => outfitSeasonFilter === "Tous" || (o.seasons || []).includes(outfitSeasonFilter))
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
                                  {item.photo && <img src={item.photo} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
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
                        className="w-full px-3 py-2 rounded text-sm mb-3"
                        style={{ border: `1px solid ${COLORS.line}`, outline: "none" }}
                      />

                      <select
                        value={agendaPickerFilter}
                        onChange={(e) => setAgendaPickerFilter(e.target.value)}
                        className="px-3 py-1.5 rounded-full text-xs mb-2"
                        style={{ border: `1px solid ${COLORS.line}`, background: COLORS.card }}
                      >
                        <option value="Tous">Toutes catégories</option>
                        {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                      </select>
                      <div className="grid grid-cols-3 gap-2 mb-4">
                        {items
                          .filter((item) => agendaPickerFilter === "Tous" || item.category === agendaPickerFilter)
                          .map((item) => {
                            const isSelected = planItemIds.includes(item.id);
                            return (
                              <button
                                type="button"
                                key={item.id}
                                onClick={() => togglePlanItem(item.id)}
                                className="rounded-lg overflow-hidden text-left"
                                style={{ border: `2px solid ${isSelected ? COLORS.rose : COLORS.line}`, opacity: isSelected ? 1 : 0.7 }}
                              >
                                <div style={{ background: item.hex, aspectRatio: "1 / 1", overflow: "hidden" }}>
                                  {item.photo && <img src={item.photo} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                                </div>
                              </button>
                            );
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
            { key: "accueil", label: "Profil", Icon: Home },
            { key: "dressing", label: "Garde-robe", Icon: Shirt },
            { key: "tenues", label: "Tenues", Icon: Layers },
            { key: "agenda", label: "Agenda", Icon: Calendar },
          ].map(({ key, label, Icon }) => {
            const active = view === key;
            return (
              <button
                key={key}
                onClick={() => changeView(key)}
                className="flex flex-col items-center gap-0.5"
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: active ? COLORS.rose : "transparent",
                }}
              >
                <Icon size={16} color={active ? "white" : "#AAAAAA"} />
                <span style={{ fontSize: 9, color: active ? "white" : "#AAAAAA" }}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}