import React, { useState, useEffect, useRef } from "react";
import { Plus, X, Shirt, Layers, Sparkles, Camera, Home, Search, Heart, ArrowLeft, Link2, Clock, Calendar, Sun, Cloud, CloudRain, CloudSnow, CloudFog, CloudLightning } from "lucide-react";
import Cropper from "react-easy-crop";

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
};

const CATEGORIES = ["Haut", "Chemise", "Veste", "Robe", "Bas", "Chaussures", "Accessoire"];
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
// L'ordre des onglets détermine le sens du glissement : passer de "dressing"
// à "tenues" glisse vers la gauche, l'inverse glisse vers la droite.
const TAB_ORDER = ["accueil", "dressing", "tenues", "agenda"];

function getGreeting(name) {
  const hour = new Date().getHours();
  if (hour < 12) return `Bonjour ${name} ! Belle journée en préparation ✨`;
  if (hour < 18) return `Bon après-midi ${name} ! On compose une tenue ?`;
  return `Bonsoir ${name} ! Un œil sur la tenue de demain ?`;
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
  }

  // Détection du glissement au doigt (swipe) : on note où le doigt touche l'écran,
  // et où il le quitte, pour calculer la distance et la direction du geste.
  const touchStartX = useRef(null);
  function handleTouchStart(e) {
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

  const [activeFilter, setActiveFilter] = useState("Tous");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("recent"); // "recent" | "name" | "category"

  const [form, setForm] = useState({ name: "", category: "Haut", hex: "#C4808C", photo: null, seasons: [], weather: [], occasions: [] });
  // Recadrage de photo : la popup s'ouvre juste après avoir choisi un fichier,
  // avant que la photo ne soit vraiment enregistrée dans le formulaire.
  const [showCropModal, setShowCropModal] = useState(false);
  const [rawImageSrc, setRawImageSrc] = useState(null); // la photo brute, pas encore recadrée
  const [cropPosition, setCropPosition] = useState({ x: 0, y: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
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
    localStorage.setItem("mon-armoire-items", JSON.stringify(items));
  }, [items, loaded]);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem("mon-armoire-outfits", JSON.stringify(outfits));
  }, [outfits, loaded]);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem("mon-armoire-agenda", JSON.stringify(agenda));
  }, [agenda, loaded]);

  // ── ACTIONS SUR LES VÊTEMENTS ──────────────
  // Au lieu d'enregistrer directement la photo choisie, on ouvre d'abord
  // la popup de recadrage — la vraie photo n'est enregistrée qu'après validation.
  function handlePhotoChange(e, targetItemId) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setRawImageSrc(reader.result);
      setCropPosition({ x: 0, y: 0 });
      setCropZoom(1);
      setCropTargetItemId(targetItemId || null);
      setShowCropModal(true);
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

  // Découpe réellement l'image selon la zone choisie dans le recadreur,
  // en dessinant uniquement cette zone sur un canvas, puis en l'exportant en data URL.
  async function getCroppedImage(imageSrc, cropAreaPixels) {
    const image = await loadImage(imageSrc);
    const canvas = document.createElement("canvas");
    canvas.width = cropAreaPixels.width;
    canvas.height = cropAreaPixels.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(
      image,
      cropAreaPixels.x, cropAreaPixels.y, cropAreaPixels.width, cropAreaPixels.height,
      0, 0, cropAreaPixels.width, cropAreaPixels.height
    );
    return canvas.toDataURL("image/jpeg", 0.9);
  }

  // Valide le recadrage : découpe l'image et l'enregistre dans le formulaire.
  async function confirmCrop() {
    if (!croppedAreaPixels) return;
    try {
      const croppedDataUrl = await getCroppedImage(rawImageSrc, croppedAreaPixels);
      if (cropTargetItemId) {
        // On modifie la photo d'un vêtement déjà enregistré, depuis sa fiche.
        // On garde aussi "photoOriginal" (la source utilisée pour ce recadrage), pour pouvoir
        // rouvrir le recadreur plus tard sur l'intégralité de l'image plutôt que sur un carré déjà coupé.
        setItems((prev) => prev.map((i) => (i.id === cropTargetItemId ? { ...i, photo: croppedDataUrl, photoOriginal: rawImageSrc } : i)));
      } else {
        setForm((prev) => ({ ...prev, photo: croppedDataUrl, photoOriginal: rawImageSrc }));
      }
    } catch (err) {
      alert("Le recadrage de cette photo a échoué. Essaie avec une autre photo.");
    }
    setShowCropModal(false);
    setRawImageSrc(null);
    setCropTargetItemId(null);
  }

  function toggleFormSeason(season) {
    setForm((prev) => ({
      ...prev,
      seasons: prev.seasons.includes(season)
        ? prev.seasons.filter((s) => s !== season)
        : [...prev.seasons, season],
    }));
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

  // Liste des vêtements filtrée (catégorie + recherche) puis triée, pour la vue Dressing.
  const visibleItems = items
    .filter((i) => activeFilter === "Tous" || i.category === activeFilter)
    .filter((i) => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "category") return a.category.localeCompare(b.category);
      if (sortBy === "worn") return (b.wornDates || []).length - (a.wornDates || []).length; // le plus porté d'abord
      return b.id - a.id; // "recent" : les plus récemment ajoutés d'abord
    });

  const detailItem = items.find((i) => i.id === detailItemId);

  // ── ACTIONS SUR LES TENUES ──────────────────
  function toggleSelected(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  }

  // Logique d'enregistrement d'une tenue, réutilisable depuis le formulaire
  // classique ET depuis la popup du générateur.
  function commitOutfit() {
    if (!outfitName.trim() || selectedIds.length === 0) return;
    const newOutfit = { id: Date.now(), name: outfitName, itemIds: selectedIds, favorite: false, wornDates: [], occasions: [] };
    setOutfits((prev) => [...prev, newOutfit]);
    setOutfitName("");
    setSelectedIds([]);
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
  const WIZARD_STEPS = ["piece", "meteo", "occasion", "couleur", "preference"];
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  // La "pièce en tête" : si choisie, elle sera systématiquement incluse dans la suggestion,
  // et les autres pièces seront piochées en priorité parmi celles qui "vont bien avec" elle.
  const [wizardBaseItemId, setWizardBaseItemId] = useState(null);
  const [wizardPickerFilter, setWizardPickerFilter] = useState("Tous");
  // Contrôle l'écran de "composition" puis le résultat affiché dans la popup.
  const [wizardGenerating, setWizardGenerating] = useState(false);
  const [wizardShowResult, setWizardShowResult] = useState(false);

  // Si non-null, le résultat du générateur sera planifié à cette date au lieu
  // d'être simplement ajouté aux tenues (utilisé depuis la popup rapide de Profil).
  const [wizardTargetDate, setWizardTargetDate] = useState(null);

  function openWizard(targetDate) {
    setWizardStep(0);
    setWizardShowResult(false);
    setWizardTargetDate(targetDate || null);
    setShowWizard(true);
  }

  function wizardNext() {
    setWizardStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
  }

  function wizardBack() {
    setWizardStep((s) => Math.max(s - 1, 0));
  }

  // Pioche un vêtement dans une catégorie, en tenant compte de tous les critères choisis
  // et de la pièce en tête si une a été choisie.
  function randomFrom(category, colorAnchor) {
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
      // Un critère couleur choisi explicitement dans le questionnaire est prioritaire sur tout.
      const filtered = pool.filter((i) => hexToColorFamily(i.hex) === genColorFamily);
      if (filtered.length > 0) pool = filtered;
    } else if (colorAnchor) {
      // Sans choix explicite, on garde la cohérence avec la première pièce de la tenue :
      // soit la même famille de couleur, soit du neutre (qui va avec tout).
      const filtered = pool.filter((i) => {
        const fam = hexToColorFamily(i.hex);
        return fam === colorAnchor || fam === "Neutres";
      });
      if (filtered.length > 0) pool = filtered;
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

    // "L'ancre couleur" : la famille de couleur de la toute première pièce choisie.
    // Une fois connue, les pièces suivantes sont piochées en priorité dans cette même
    // famille ou en neutre — pour éviter une tenue où chaque pièce jure avec les autres.
    let colorAnchor = null;
    function pick(category) {
      const item = randomFrom(category, colorAnchor);
      if (item && !colorAnchor && !genColorFamily) colorAnchor = hexToColorFamily(item.hex);
      return item;
    }

    let base;
    if (baseItem && baseItem.category === "Robe") {
      base = [baseItem];
      colorAnchor = hexToColorFamily(baseItem.hex);
    } else {
      // Une fois sur trois environ, on part sur une robe plutôt que haut + bas séparés
      // (si le dressing en contient au moins une, sinon on retombe sur haut + bas) —
      // sauf si la pièce en tête est justement un haut ou un bas, auquel cas on la respecte.
      const forceTopBottom = baseItem && (baseItem.category === "Haut" || baseItem.category === "Bas");
      const tryDress = !forceTopBottom && Math.random() < 0.33 && items.some((i) => i.category === "Robe");
      base = tryDress ? [pick("Robe")] : [pick("Haut"), pick("Bas")];
    }

    const picks = [...base, pick("Chaussures")];
    const forceInclude = (cat) => baseItem && baseItem.category === cat;
    if (forceInclude("Chemise") || Math.random() > 0.5) picks.push(pick("Chemise"));
    if (forceInclude("Veste") || Math.random() > 0.5) picks.push(pick("Veste"));
    if (forceInclude("Accessoire") || Math.random() > 0.5) picks.push(pick("Accessoire"));
    const found = picks.filter(Boolean);
    setSelectedIds(found.map((i) => i.id));
    setOutfitName(found.length >= 2 ? "Tenue suggérée" : "");
  }

  // Lance la génération avec les critères choisis, puis ferme la popup et ouvre
  // le formulaire de création pour que tu puisses ajuster et enregistrer.
  function wizardGenerate() {
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
    .filter((o) => outfitOccasionFilter === "Tous" || (o.occasions || []).includes(outfitOccasionFilter));

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
    const newOutfit = { id: newOutfitId, name: label.trim() || "Tenue", itemIds, favorite: false, wornDates: [], seasons: [], weather: [], occasions: [] };
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

  const upcomingEntries = agendaEntries.filter((e) => e.dateStr >= todayKey());
  const pastEntries = agendaEntries.filter((e) => e.dateStr < todayKey()).reverse(); // plus récent en premier
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
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
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
        <div style={{ textAlign: "center", fontFamily: "Inter, sans-serif" }}>
          <div
            className="splash-mark"
            style={{ width: 56, height: 56, borderRadius: "50%", background: "#FF4B33", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}
          >
            <Shirt size={26} color="#FFFFFF" />
          </div>
          <div className="splash-logo" style={{ fontSize: 28, fontWeight: 700, color: "#111111", letterSpacing: "-0.02em" }}>
            Mon Armoire
          </div>
          <div className="splash-tag" style={{ fontSize: 13, color: "#999999", marginTop: 6 }}>
            Lorem ipsum dolor sit amet
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
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'); * { font-family: 'Inter', sans-serif; }`}</style>
        <div style={{ width: "100%", maxWidth: 320, textAlign: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#FF4B33", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
            <Shirt size={26} color="#FFFFFF" />
          </div>
          <p style={{ fontSize: 22, fontWeight: 700, color: "#111111", marginBottom: 8 }}>Bienvenue dans Mon Armoire</p>
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
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { font-family: 'Inter', sans-serif; box-sizing: border-box; }
        .display { font-family: 'Inter', sans-serif; letter-spacing: -0.02em; }
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
      `}</style>

      <div
        className="max-w-3xl mx-auto px-5 pt-10 app-content"
        style={{ paddingBottom: 100 }}
      >
        {/* ── EN-TÊTE — uniquement sur la page Profil ── */}
        {view === "accueil" && (
          <div className="mb-7">
            <h1 className="display text-3xl" style={{ fontWeight: 600 }}>{formatTodayHeader()}</h1>

            {weatherStatus === "granted" && weather && (() => {
              const { label, Icon } = getWeatherInfo(weather.code);
              return (
                <div className="mt-1">
                  <div className="flex items-center gap-1.5">
                    <Icon size={16} color={COLORS.rose} />
                    <p className="text-sm" style={{ color: COLORS.ink, opacity: 0.8 }}>{label}, {weather.temp}°</p>
                  </div>
                  <p className="text-xs" style={{ color: COLORS.muted }}>{weather.min}° - {weather.max}°</p>
                </div>
              );
            })()}

            {weatherStatus === "loading" && (
              <p className="text-xs mt-1" style={{ color: COLORS.muted }}>Météo…</p>
            )}

            {(weatherStatus === "denied" || weatherStatus === "error") && (
              <button onClick={requestWeather} className="text-xs mt-1" style={{ color: COLORS.rose }}>
                Activer la météo
              </button>
            )}
          </div>
        )}

        {/* ══════════════════ VUE ACCUEIL ══════════════════ */}
        {view === "accueil" && (
          <div key={view} className={slideDir === "right" ? "slide-right" : "slide-left"}>
            <div className="p-5 rounded-lg mb-5" style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }}>
              <p className="display text-xl mb-4" style={{ fontWeight: 600 }}>{getGreeting(userName)}</p>

              {todayEntries.map((entry) => {
                const validated = isPlanValidatedToday(entry.planItems);
                return (
                  <div
                    key={entry.entryId}
                    onClick={() => setOpenEntryId(entry.entryId)}
                    className="relative mb-4 p-4 rounded-lg cursor-pointer"
                    style={{ background: COLORS.ivory, border: `1px solid ${COLORS.line}` }}
                  >
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeAgendaEntry(entry.dateStr, entry.entryId); }}
                      className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center"
                      style={{ background: "rgba(0,0,0,0.06)" }}
                    >
                      <X size={13} />
                    </button>
                    <p className="text-sm font-medium mb-3 pr-8" style={{ color: COLORS.rose }}>
                      {entry.label} {validated ? "— validée ✓" : "— toujours partante ?"}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {entry.planItems.map((item) => (
                        <div key={item.id} className="rounded-lg overflow-hidden" style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }}>
                          {item.photo ? (
                            <img src={item.photo} alt={item.name} style={{ width: "100%", height: 80, objectFit: "cover" }} />
                          ) : (
                            <div style={{ background: item.hex, height: 80 }} />
                          )}
                          <div className="p-2">
                            <p className="text-xs font-medium truncate">{item.name}</p>
                            <p className="text-[11px]" style={{ color: COLORS.muted }}>{item.category}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={() => openQuickPlan(todayKey())}
                className="flex items-center gap-1.5 text-xs"
                style={{ color: COLORS.rose }}
              >
                <Plus size={13} /> {todayEntries.length > 0 ? "Ajouter une autre tenue pour aujourd'hui" : "Planifier une tenue pour aujourd'hui"}
              </button>
            </div>

            {/* ── Et demain ? ── */}
            <div className="p-5 rounded-lg mb-5" style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }}>
              <p className="display text-xl mb-3" style={{ fontWeight: 600 }}>Et demain ?</p>

              {tomorrowEntries.length === 0 ? (
                <p className="text-xs mb-3" style={{ opacity: 0.5 }}>Rien de prévu.</p>
              ) : (
                tomorrowEntries.map((entry) => (
                  <div key={entry.entryId} className="mb-3">
                    <p className="text-xs font-medium mb-2" style={{ color: COLORS.rose }}>{entry.label}</p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {entry.planItems.map((item) => (
                        <div key={item.id} className="rounded-lg overflow-hidden" style={{ background: COLORS.ivory, border: `1px solid ${COLORS.line}` }}>
                          {item.photo ? (
                            <img src={item.photo} alt={item.name} style={{ width: "100%", height: 56, objectFit: "cover" }} />
                          ) : (
                            <div style={{ background: item.hex, height: 56 }} />
                          )}
                          <p className="text-[10px] px-1.5 py-1 truncate">{item.name}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}

              <button
                type="button"
                onClick={() => openQuickPlan(tomorrowKey())}
                className="flex items-center gap-1.5 text-xs"
                style={{ color: COLORS.rose }}
              >
                <Plus size={13} /> Ajouter une tenue pour demain
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <button onClick={() => changeView("dressing")} className="p-4 rounded-lg text-left" style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }}>
                <p className="display text-2xl" style={{ fontWeight: 600, color: COLORS.rose }}>{items.length}</p>
                <p className="text-xs" style={{ opacity: 0.6 }}>vêtement{items.length > 1 ? "s" : ""} au total</p>
              </button>
              <button onClick={() => changeView("tenues")} className="p-4 rounded-lg text-left" style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }}>
                <p className="display text-2xl" style={{ fontWeight: 600, color: COLORS.sage }}>{outfits.length}</p>
                <p className="text-xs" style={{ opacity: 0.6 }}>tenue{outfits.length > 1 ? "s" : ""} enregistrée{outfits.length > 1 ? "s" : ""}</p>
              </button>
            </div>


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
                                <div style={{ background: item.hex, height: 36, overflow: "hidden" }}>
                                  {item.photo && <img src={item.photo} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                                </div>
                                <p className="text-[10px] px-1 py-0.5 truncate">{item.name}</p>
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
                      onClick={() => { removeAgendaEntry(entry.dateStr, entry.entryId); setOpenEntryId(null); }}
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
          <div key={view} className={slideDir === "right" ? "slide-right" : "slide-left"}>
            {/* Bouton pour ouvrir/fermer le formulaire d'ajout — replié par défaut */}
            <div className="flex gap-2 mb-4 flex-wrap">
              <button
                type="button"
                onClick={() => setShowAddForm((v) => !v)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm text-white"
                style={{ background: COLORS.rose }}
              >
                <Plus size={16} style={{ transform: showAddForm ? "rotate(45deg)" : "none", transition: "transform 0.15s" }} />
                {showAddForm ? "Fermer" : "Ajouter un vêtement"}
              </button>
            </div>

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
                      <label className="block text-xs mb-1" style={{ opacity: 0.6 }}>Nom</label>
                      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex : Chemise en lin" className="w-full px-3 py-2 rounded text-sm" style={{ border: `1px solid ${COLORS.line}`, outline: "none" }} />
                    </div>
                    <div>
                      <label className="block text-xs mb-1" style={{ opacity: 0.6 }}>Catégorie</label>
                      <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="px-3 py-2 rounded text-sm" style={{ border: `1px solid ${COLORS.line}` }}>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs mb-1" style={{ opacity: 0.6 }}>Photo</label>
                      <label className="flex items-center justify-center rounded cursor-pointer overflow-hidden" style={{ width: 40, height: 36, border: `1px solid ${COLORS.line}`, background: form.photo ? "transparent" : "#FAFAFA" }}>
                        {form.photo ? <img src={form.photo} alt="Aperçu" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Camera size={15} style={{ opacity: 0.4 }} />}
                        <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
                      </label>
                    </div>
                    <div>
                      <label className="block text-xs mb-1" style={{ opacity: 0.6 }}>Couleur</label>
                      <input type="color" value={form.hex} onChange={(e) => setForm({ ...form, hex: e.target.value })} className="w-10 h-9 rounded cursor-pointer" style={{ border: `1px solid ${COLORS.line}` }} />
                    </div>
                    <div className="w-full">
                      <label className="block text-xs mb-1" style={{ opacity: 0.6 }}>Saison{form.seasons.length > 1 ? "s" : ""}</label>
                      <div className="flex gap-1.5 flex-wrap">
                        {SEASONS.map((s) => (
                          <button type="button" key={s} onClick={() => toggleFormSeason(s)} className="px-2.5 py-1 rounded-full text-xs" style={{
                            background: form.seasons.includes(s) ? COLORS.sage : "transparent",
                            color: form.seasons.includes(s) ? "white" : COLORS.ink,
                            border: `1px solid ${form.seasons.includes(s) ? COLORS.sage : COLORS.line}`,
                          }}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="w-full">
                      <label className="block text-xs mb-1" style={{ opacity: 0.6 }}>Météo adaptée</label>
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
                      <label className="block text-xs mb-1" style={{ opacity: 0.6 }}>Occasion{form.occasions.length > 1 ? "s" : ""}</label>
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

            {/* Recherche + tri */}
            <div className="flex flex-wrap gap-2 mb-4">
              <div className="flex items-center gap-2 flex-1 min-w-[160px] px-3 py-2 rounded" style={{ border: `1px solid ${COLORS.line}`, background: COLORS.card }}>
                <Search size={14} style={{ opacity: 0.4 }} />
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Rechercher un vêtement..." className="flex-1 text-sm outline-none" style={{ background: "transparent" }} />
              </div>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="px-3 py-2 rounded text-sm" style={{ border: `1px solid ${COLORS.line}`, background: COLORS.card }}>
                <option value="recent">Plus récents</option>
                <option value="name">Nom (A-Z)</option>
                <option value="category">Catégorie</option>
                <option value="worn">Le plus porté</option>
              </select>
            </div>

            <div className="flex gap-2 mb-6 flex-wrap">
              {["Tous", ...CATEGORIES].map((cat) => (
                <button key={cat} onClick={() => setActiveFilter(cat)} className="px-3 py-1.5 rounded-full text-xs" style={{
                  background: activeFilter === cat ? COLORS.ink : "transparent",
                  color: activeFilter === cat ? COLORS.ivory : COLORS.ink,
                  border: `1px solid ${activeFilter === cat ? COLORS.ink : COLORS.line}`,
                }}>
                  {cat}
                </button>
              ))}
            </div>

            {visibleItems.length === 0 ? (
              <p className="text-sm py-10 text-center" style={{ opacity: 0.5 }}>Rien à afficher — ajoute un vêtement ou change ta recherche.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {visibleItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setDetailItemId(item.id)}
                    className="rounded-lg overflow-hidden relative group text-left"
                    style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }}
                  >
                    {item.photo ? (
                      <img src={item.photo} alt={item.name} style={{ width: "100%", height: 80, objectFit: "cover" }} />
                    ) : (
                      <div style={{ background: item.hex, height: 80 }} />
                    )}
                    <div className="p-3">
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs" style={{ color: COLORS.muted }}>
                        {item.category}
                        {sortBy === "worn" && ` · portée ${(item.wornDates || []).length}x`}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ FICHE ARTICLE (détail d'un vêtement) ══════════════════ */}
        {view === "dressing" && detailItem && (
          <div key={detailItemId} className="slide-right">
            <button onClick={() => setDetailItemId(null)} className="flex items-center gap-1.5 text-sm mb-4" style={{ opacity: 0.6 }}>
              <ArrowLeft size={15} /> Retour aux articles
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
              <div className="p-4">
                <p className="display text-xl" style={{ fontWeight: 600 }}>{detailItem.name}</p>
              </div>
            </div>

            {/* Catégorie — modifiable si tu t'es trompée à l'ajout */}
            <div className="mb-5">
              <p className="text-xs font-medium mb-2" style={{ opacity: 0.6 }}>Catégorie</p>
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
              <p className="text-xs font-medium mb-2" style={{ opacity: 0.6 }}>Couleur</p>
              <input
                type="color"
                value={detailItem.hex}
                onChange={(e) => setItems((prev) => prev.map((i) => i.id === detailItem.id ? { ...i, hex: e.target.value } : i))}
                className="w-12 h-9 rounded cursor-pointer"
                style={{ border: `1px solid ${COLORS.line}` }}
              />
            </div>

            {/* Saisons */}
            <div className="mb-5">
              <p className="text-xs font-medium mb-2" style={{ opacity: 0.6 }}>Saison{detailItem.seasons.length > 1 ? "s" : ""}</p>
              <div className="flex gap-1.5 flex-wrap">
                {SEASONS.map((s) => {
                  const active = detailItem.seasons.includes(s);
                  return (
                    <button key={s} onClick={() => setItems((prev) => prev.map((i) => i.id === detailItem.id ? { ...i, seasons: active ? i.seasons.filter((x) => x !== s) : [...i.seasons, s] } : i))}
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

            {/* Météo — "|| []" au cas où ce vêtement existait avant l'ajout de ce champ */}
            <div className="mb-5">
              <p className="text-xs font-medium mb-2" style={{ opacity: 0.6 }}>Météo adaptée</p>
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
              <p className="text-xs font-medium mb-2" style={{ opacity: 0.6 }}>Occasion{(detailItem.occasions || []).length > 1 ? "s" : ""}</p>
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
                <p className="text-xs" style={{ opacity: 0.5 }}>Aucune association pour l'instant.</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {(detailItem.pairsWith || []).map((otherId) => {
                    const other = items.find((i) => i.id === otherId);
                    if (!other) return null;
                    return (
                      <div key={other.id} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${COLORS.line}` }}>
                        <div style={{ background: other.hex, height: 40, overflow: "hidden" }}>
                          {other.photo && <img src={other.photo} alt={other.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                        </div>
                        <p className="text-[10px] px-1.5 py-1 truncate">{other.name}</p>
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
                            <div style={{ background: other.hex, height: 44, overflow: "hidden" }}>
                              {other.photo && <img src={other.photo} alt={other.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                            </div>
                            <p className="text-[10px] px-1.5 py-1 truncate">{other.name}</p>
                          </button>
                        );
                      })}
                  </div>
                </div>
              </div>
            )}

            {/* Notes libres */}
            <div className="mb-5">
              <p className="text-xs font-medium mb-2" style={{ opacity: 0.6 }}>Notes</p>
              <textarea
                value={detailItem.notes || ""}
                onChange={(e) => setItems((prev) => prev.map((i) => (i.id === detailItem.id ? { ...i, notes: e.target.value } : i)))}
                placeholder="Un détail à retenir sur ce vêtement..."
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
                  Porté {(detailItem.wornDates || []).length} fois
                </p>
              </div>
              {(detailItem.wornDates || []).length === 0 ? (
                <p className="text-xs" style={{ opacity: 0.5 }}>Pas encore porté — ça viendra via une tenue !</p>
              ) : (
                <p className="text-xs" style={{ opacity: 0.7 }}>
                  Dernière fois : {formatDate(detailItem.wornDates[(detailItem.wornDates || []).length - 1])}
                </p>
              )}
            </div>

            <button onClick={() => removeItem(detailItem.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs" style={{ border: "1px solid #C4808C", color: "#C4808C" }}>
              <X size={13} /> Supprimer ce vêtement
            </button>
          </div>
        )}

        {/* ══════════════════ VUE TENUES ══════════════════ */}
        {view === "tenues" && (
          <div key={view} className={slideDir === "right" ? "slide-right" : "slide-left"}>
            <div className="flex gap-2 mb-4 flex-wrap">
              <button
                type="button"
                onClick={() => { setCreateOutfitStep("select"); setShowOutfitForm((v) => !v); }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm text-white"
                style={{ background: COLORS.rose }}
              >
                <Plus size={16} style={{ transform: showOutfitForm ? "rotate(45deg)" : "none", transition: "transform 0.15s" }} />
                {showOutfitForm ? "Fermer" : "Créer une tenue"}
              </button>
              <button type="button" onClick={() => openWizard()} className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm" style={{ border: `1px solid ${COLORS.gold}`, color: COLORS.gold }}>
                <Sparkles size={14} /> Générer une tenue
              </button>
            </div>

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
                        <p className="text-xs mb-3" style={{ opacity: 0.6 }}>Clique sur les vêtements à combiner.</p>

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
                                <div style={{ background: item.hex, height: 44, overflow: "hidden" }}>
                                  {item.photo && <img src={item.photo} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                                </div>
                                <p className="text-[11px] px-1.5 py-1 truncate">{item.name}</p>
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
                              <div key={item.id} className="rounded-lg overflow-hidden" style={{ background: COLORS.ivory, border: `1px solid ${COLORS.line}` }}>
                                {item.photo ? (
                                  <img src={item.photo} alt={item.name} style={{ width: "100%", height: 50, objectFit: "cover" }} />
                                ) : (
                                  <div style={{ background: item.hex, height: 50 }} />
                                )}
                                <p className="text-[10px] px-1.5 py-1 truncate">{item.name}</p>
                              </div>
                            );
                          })}
                        </div>

                        <label className="block text-xs mb-1" style={{ opacity: 0.6 }}>Nom de la tenue</label>
                        <input value={outfitName} onChange={(e) => setOutfitName(e.target.value)} placeholder="Ex : Look bureau lundi" className="w-full px-3 py-2 rounded text-sm mb-3" style={{ border: `1px solid ${COLORS.line}`, outline: "none" }} />

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
            <div className="flex gap-2 flex-wrap mb-4">
              <button onClick={() => setFavoritesOnly((v) => !v)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs" style={{
                background: favoritesOnly ? COLORS.rose : "transparent",
                color: favoritesOnly ? "white" : COLORS.ink,
                border: `1px solid ${favoritesOnly ? COLORS.rose : COLORS.line}`,
              }}>
                <Heart size={13} fill={favoritesOnly ? "white" : "none"} /> Favoris seulement
              </button>

              <select
                value={outfitSeasonFilter}
                onChange={(e) => setOutfitSeasonFilter(e.target.value)}
                className="px-3 py-1.5 rounded-full text-xs"
                style={{ border: `1px solid ${COLORS.line}`, background: COLORS.card }}
              >
                <option value="Tous">Toutes saisons</option>
                {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>

              <select
                value={outfitWeatherFilter}
                onChange={(e) => setOutfitWeatherFilter(e.target.value)}
                className="px-3 py-1.5 rounded-full text-xs"
                style={{ border: `1px solid ${COLORS.line}`, background: COLORS.card }}
              >
                <option value="Tous">Toute météo</option>
                {WEATHER_TAGS.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>

              <select
                value={outfitOccasionFilter}
                onChange={(e) => setOutfitOccasionFilter(e.target.value)}
                className="px-3 py-1.5 rounded-full text-xs"
                style={{ border: `1px solid ${COLORS.line}`, background: COLORS.card }}
              >
                <option value="Tous">Toutes occasions</option>
                {OCCASIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            {visibleOutfits.length === 0 ? (
              <p className="text-sm py-6 text-center" style={{ opacity: 0.5 }}>
                {favoritesOnly ? "Aucune tenue favorite pour l'instant." : "Aucune tenue enregistrée pour l'instant."}
              </p>
            ) : (
              <div className="space-y-3">
                {visibleOutfits.map((outfit) => (
                  <div
                    key={outfit.id}
                    onClick={() => setDetailOutfitId(outfit.id)}
                    className="rounded-lg p-4 relative cursor-pointer"
                    style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }}
                  >
                    <div className="absolute top-3 right-3 flex gap-1">
                      <button onClick={(e) => { e.stopPropagation(); toggleFavoriteOutfit(outfit.id); }} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.06)" }}>
                        <Heart size={13} color={outfit.favorite ? COLORS.rose : COLORS.ink} fill={outfit.favorite ? COLORS.rose : "none"} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); removeOutfit(outfit.id); }} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.06)" }}>
                        <X size={14} />
                      </button>
                    </div>
                    <p className="text-sm font-medium mb-3 pr-16">{outfit.name}</p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-3">
                      {itemsForOutfit(outfit).map((item) => (
                        <div key={item.id} className="rounded-lg overflow-hidden" style={{ background: COLORS.ivory, border: `1px solid ${COLORS.line}` }}>
                          {item.photo ? (
                            <img src={item.photo} alt={item.name} style={{ width: "100%", height: 64, objectFit: "cover" }} />
                          ) : (
                            <div style={{ background: item.hex, height: 64 }} />
                          )}
                          <div className="px-1.5 py-1">
                            <p className="text-[10px] font-medium truncate">{item.name}</p>
                            <p className="text-[9px]" style={{ color: COLORS.muted }}>{item.category}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <p className="text-[11px]" style={{ opacity: 0.5 }}>
                        {(outfit.wornDates || []).length === 0 ? "Jamais portée" : `Portée ${(outfit.wornDates || []).length}x · dernière : ${formatDate(outfit.wornDates[outfit.wornDates.length - 1])}`}
                      </p>
                      <button
                        onClick={(e) => { e.stopPropagation(); isWornToday(outfit) ? unmarkOutfitWorn(outfit) : markOutfitWorn(outfit); }}
                        className="text-[11px] px-2 py-1 rounded-full"
                        style={
                          isWornToday(outfit)
                            ? { background: COLORS.rose, color: "white", border: `1px solid ${COLORS.rose}` }
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
                      <div key={item.id} className="rounded-lg overflow-hidden" style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }}>
                        {item.photo ? (
                          <img src={item.photo} alt={item.name} style={{ width: "100%", height: 70, objectFit: "cover" }} />
                        ) : (
                          <div style={{ background: item.hex, height: 70 }} />
                        )}
                        <p className="text-[10px] px-1.5 py-1 truncate">{item.name}</p>
                      </div>
                    ))}
                  </div>

                  {/* Saisons */}
                  <div className="mb-5">
                    <p className="text-xs font-medium mb-2" style={{ opacity: 0.6 }}>Saison{(outfit.seasons || []).length > 1 ? "s" : ""}</p>
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
                    <p className="text-xs font-medium mb-2" style={{ opacity: 0.6 }}>Météo adaptée</p>
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
                    <p className="text-xs font-medium mb-2" style={{ opacity: 0.6 }}>Occasion{(outfit.occasions || []).length > 1 ? "s" : ""}</p>
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
                        Portée {(outfit.wornDates || []).length} fois
                      </p>
                    </div>
                    {(outfit.wornDates || []).length === 0 ? (
                      <p className="text-xs" style={{ opacity: 0.5 }}>Pas encore portée.</p>
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
                    <button onClick={() => { removeOutfit(outfit.id); setDetailOutfitId(null); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs" style={{ border: "1px solid #C4808C", color: "#C4808C" }}>
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
            {items.length === 0 ? (
              <p className="text-xs py-3" style={{ opacity: 0.5 }}>
                Ajoute d'abord des vêtements dans l'onglet "Garde-robe" pour pouvoir planifier une tenue ici.
              </p>
            ) : (
              <button
                type="button"
                onClick={() => openQuickPlan(todayKey())}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm text-white mb-5"
                style={{ background: COLORS.rose }}
              >
                <Plus size={16} /> Planifier une tenue
              </button>
            )}

            {/* ── Calendrier ── */}
            <div className="p-3 rounded-lg mb-5" style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }}>
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                  className="w-6 h-6 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(0,0,0,0.06)" }}
                >
                  <ArrowLeft size={12} />
                </button>
                <p className="text-xs font-medium" style={{ textTransform: "capitalize" }}>
                  {calendarMonth.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
                </p>
                <button
                  onClick={() => setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                  className="w-6 h-6 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(0,0,0,0.06)" }}
                >
                  <ArrowLeft size={12} style={{ transform: "rotate(180deg)" }} />
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

            {upcomingEntries.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-medium mb-2" style={{ opacity: 0.6 }}>À venir</p>
                <div className="space-y-2">
                  {upcomingEntries.map((entry) => (
                    <div key={entry.entryId} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: COLORS.card, border: `1px solid ${COLORS.line}` }}>
                      <div className="flex gap-1">
                        {entry.planItems.slice(0, 4).map((item) => (
                          <div key={item.id} className="rounded overflow-hidden" style={{ background: item.hex, width: 28, height: 28, border: `1px solid ${COLORS.line}` }}>
                            {item.photo && <img src={item.photo} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                          </div>
                        ))}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">
                          {entry.dateStr === todayKey() ? "Aujourd'hui" : formatAgendaDate(entry.dateStr)} — {entry.label}
                        </p>
                        <p className="text-xs" style={{ color: COLORS.muted }}>
                          {entry.planItems.map((i) => i.name).join(", ")}
                        </p>
                      </div>
                      <button onClick={() => removeAgendaEntry(entry.dateStr, entry.entryId)} className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.06)" }}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {pastEntries.length > 0 && (
              <div>
                <p className="text-xs font-medium mb-2" style={{ opacity: 0.6 }}>Passées</p>
                <div className="space-y-2">
                  {pastEntries.map((entry) => (
                    <div key={entry.entryId} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: COLORS.card, border: `1px solid ${COLORS.line}`, opacity: 0.6 }}>
                      <div className="flex gap-1">
                        {entry.planItems.slice(0, 4).map((item) => (
                          <div key={item.id} className="rounded overflow-hidden" style={{ background: item.hex, width: 28, height: 28, border: `1px solid ${COLORS.line}` }}>
                            {item.photo && <img src={item.photo} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                          </div>
                        ))}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{formatAgendaDate(entry.dateStr)} — {entry.label}</p>
                        <p className="text-xs" style={{ color: COLORS.muted }}>
                          {entry.planItems.map((i) => i.name).join(", ")}
                        </p>
                      </div>
                      <button onClick={() => removeAgendaEntry(entry.dateStr, entry.entryId)} className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.06)" }}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                      <p className="text-xs py-4 text-center" style={{ opacity: 0.5 }}>Rien de prévu ce jour-là.</p>
                    ) : (
                      <div className="space-y-3 mb-4">
                        {dayEntries.map((entry) => (
                          <div key={entry.entryId}>
                            <p className="text-xs font-medium mb-2" style={{ color: COLORS.rose }}>{entry.label}</p>
                            <div className="grid grid-cols-3 gap-2">
                              {entry.planItems.map((item) => (
                                <div key={item.id} className="rounded-lg overflow-hidden" style={{ background: COLORS.ivory, border: `1px solid ${COLORS.line}` }}>
                                  {item.photo ? (
                                    <img src={item.photo} alt={item.name} style={{ width: "100%", height: 50, objectFit: "cover" }} />
                                  ) : (
                                    <div style={{ background: item.hex, height: 50 }} />
                                  )}
                                  <p className="text-[10px] px-1 py-0.5 truncate">{item.name}</p>
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
                    <p className="text-xs mb-4" style={{ opacity: 0.5 }}>
                      {wizardGenerating ? "Composition en cours…" : wizardShowResult ? "Voici ta tenue" : `Étape ${wizardStep + 1} sur ${WIZARD_STEPS.length}`}
                    </p>

                    {/* ── Écran de chargement ── */}
                    {wizardGenerating && (
                      <div className="py-10 flex flex-col items-center justify-center">
                        <Sparkles size={28} color={COLORS.rose} className="wizard-spin" />
                        <p className="text-xs mt-3" style={{ opacity: 0.5 }}>On assemble ta tenue idéale…</p>
                      </div>
                    )}

                    {/* ── Écran de résultat : la tenue générée, prête à enregistrer ── */}
                    {!wizardGenerating && wizardShowResult && (
                      <div className="mb-4">
                        <div className="grid grid-cols-3 gap-2 mb-4">
                          {selectedIds.map((id) => {
                            const item = items.find((i) => i.id === id);
                            if (!item) return null;
                            return (
                              <div key={item.id} className="rounded-lg overflow-hidden" style={{ background: COLORS.ivory, border: `1px solid ${COLORS.line}` }}>
                                {item.photo ? (
                                  <img src={item.photo} alt={item.name} style={{ width: "100%", height: 60, objectFit: "cover" }} />
                                ) : (
                                  <div style={{ background: item.hex, height: 60 }} />
                                )}
                                <p className="text-[10px] px-1.5 py-1 truncate">{item.name}</p>
                              </div>
                            );
                          })}
                        </div>

                        <label className="block text-xs mb-1" style={{ opacity: 0.6 }}>Nom de la tenue</label>
                        <input
                          value={outfitName}
                          onChange={(e) => setOutfitName(e.target.value)}
                          placeholder="Ex : Look bureau lundi"
                          className="w-full px-3 py-2 rounded text-sm mb-3"
                          style={{ border: `1px solid ${COLORS.line}`, outline: "none" }}
                        />

                        <div className="flex gap-2">
                          <button onClick={wizardGenerate} className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm" style={{ border: `1px solid ${COLORS.line}`, color: COLORS.ink }}>
                            <Sparkles size={14} /> Régénérer
                          </button>
                          <button
                            onClick={wizardSaveOutfit}
                            disabled={!wizardTargetDate && !outfitName.trim()}
                            className="flex-1 px-4 py-2 rounded-full text-sm text-white"
                            style={{ background: COLORS.rose, opacity: (!wizardTargetDate && !outfitName.trim()) ? 0.4 : 1 }}
                          >
                            {wizardTargetDate ? `Planifier pour ${wizardTargetDate === todayKey() ? "aujourd'hui" : "demain"}` : "Ajouter à mes tenues"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ── Questions, une étape à la fois ── */}
                    {!wizardGenerating && !wizardShowResult && (
                      <>
                    {step === "piece" && (
                      <div className="mb-4">
                        <p className="text-sm font-medium mb-2">Une pièce en tête ?</p>
                        <p className="text-xs mb-3" style={{ opacity: 0.6 }}>
                          Choisis un vêtement que tu veux absolument porter, et on construit la tenue autour — ou passe cette étape pour une suggestion 100% surprise.
                        </p>
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
                                  <div style={{ background: item.hex, height: 44, overflow: "hidden" }}>
                                    {item.photo && <img src={item.photo} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                                  </div>
                                  <p className="text-[10px] px-1 py-0.5 truncate">{item.name}</p>
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
                        <p className="text-sm font-medium mb-3">Plutôt quelle gamme de couleur ?</p>
                        <div className="flex gap-1.5 flex-wrap">
                          {COLOR_FAMILIES.map((c) => {
                            const active = genColorFamily === c;
                            return (
                              <button type="button" key={c} onClick={() => setGenColorFamily(active ? null : c)} className="px-3 py-1.5 rounded-full text-sm" style={{
                                background: active ? COLORS.sage : "transparent",
                                color: active ? "white" : COLORS.ink,
                                border: `1px solid ${active ? COLORS.sage : COLORS.line}`,
                              }}>
                                {c}
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
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm text-white"
                    style={{ background: COLORS.rose }}
                  >
                    Valider le recadrage
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
                        <p className="font-medium">Choisir une tenue déjà enregistrée</p>
                        <p className="text-xs" style={{ color: COLORS.muted }}>
                          {outfits.length === 0 ? "Aucune tenue enregistrée pour l'instant" : "Parmi celles que tu as créées dans l'onglet Tenues"}
                        </p>
                      </button>
                      <button onClick={() => setQuickPlanMode("create")} className="w-full text-left p-3 rounded-lg text-sm" style={{ border: `1px solid ${COLORS.line}` }}>
                        <p className="font-medium">Créer une tenue</p>
                        <p className="text-xs" style={{ color: COLORS.muted }}>Choisis les vêtements toi-même</p>
                      </button>
                      <button
                        onClick={() => { setShowQuickPlanModal(false); openWizard(planDate); }}
                        className="w-full text-left p-3 rounded-lg text-sm"
                        style={{ border: `1px solid ${COLORS.gold}` }}
                      >
                        <p className="font-medium" style={{ color: COLORS.gold }}>Générer une tenue</p>
                        <p className="text-xs" style={{ color: COLORS.muted }}>Le générateur te pose quelques questions et propose une tenue</p>
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
                      <label className="block text-xs mb-1" style={{ opacity: 0.6 }}>Nom (optionnel)</label>
                      <input
                        value={planLabel}
                        onChange={(e) => setPlanLabel(e.target.value)}
                        placeholder="Ex : Soir"
                        className="w-full px-3 py-2 rounded text-sm mb-3"
                        style={{ border: `1px solid ${COLORS.line}`, outline: "none" }}
                      />

                      <p className="text-xs mb-2" style={{ opacity: 0.6 }}>Choisis les vêtements</p>
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
                                <div style={{ background: item.hex, height: 44, overflow: "hidden" }}>
                                  {item.photo && <img src={item.photo} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                                </div>
                                <p className="text-[10px] px-1.5 py-1 truncate">{item.name}</p>
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
                        Aussi l'ajouter à ma collection de tenues
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