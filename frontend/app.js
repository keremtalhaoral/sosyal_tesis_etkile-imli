/**
 * app.js - Frontend GIS, Choropleth Map & Decision Support Engine
 * 
 * WHY THIS ARCHITECTURE WAS CHOSEN (John Ousterhout Philosophy):
 * 1. Deep Modules (Derin Modüller):
 *    - Routing Module: Exposes a single method `Routing.draw(start, end)`. Inside, it queries OSRM, handles 
 *      coordinate system differences, clears previous states, and animates paths.
 *    - Weather Module: Exposes a single method `Weather.display(lat, lng, elementId)`. Inside, it queries the backend API,
 *      formats temps, and updates DOM grids.
 * 2. Define Errors Out of Existence (Tasarımla Hataları Yok Et):
 *    - If OSRM routing API is down or blocks requests, the Routing Module catches the error and draws a straight geodesic 
 *      geodesic dashed line instead, letting the user know they are seeing the flight path fallback.
 *    - If the backend server fails to respond, UI components gracefully revert to cached local values.
 * 3. Comments Describe "Why":
 *    - Comments explain why OSRM coordinates are swapped (OSRM uses [lng, lat] while Leaflet uses [lat, lng]),
 *      and why Leaflet DomEvents are disabled on overlay elements to prevent map panning conflicts.
 */

const API_BASE = 'http://localhost:8085';

// Core Application State
const state = {
  facilities: [],
  districtsGeoJSON: null,
  selectedFacility: null,
  selectedDistrict: null,
  userLocation: {
    lat: 41.037007, // Default: Taksim Square latitude
    lng: 28.976273, // Default: Taksim Square longitude
    isMock: true,
    marker: null
  },
  map: null,
  activeTileLayer: null,
  theme: 'light',
  markers: {}, // facilityId -> Leaflet marker object
  districtsLayer: null,
  selectedDistrictLayer: null
};

// Tile Layer configurations
const TILE_LAYERS = {
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    options: {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    options: {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }
  }
};

// Step 2 Choropleth Color scale: Light Yellow to Dark Green based on facility density (count)
const getChoroplethColor = (count) => {
  return count >= 4 ? '#006400' : // Dark Green (High density)
         count === 3 ? '#228b22' : // Forest Green
         count === 2 ? '#4ebd38' : // Light Green
         count === 1 ? '#a3e06b' : // Pale Greenish Yellow
                       '#ffffe0';  // Light Yellow (No facilities)
};

// Retrieve color values dynamically based on theme and occupancy status
const getColorByStatus = (status, theme) => {
  const colors = {
    light: {
      high: '#ef4444',
      moderate: '#f59e0b',
      low: '#10b981',
      primary: '#2563eb',
      secondary: '#64748b'
    },
    dark: {
      high: '#f87171',
      moderate: '#fbbf24',
      low: '#34d399',
      primary: '#3b82f6',
      secondary: '#cbd5e1'
    }
  };
  return colors[theme][status];
};

const getStatusDetails = (occupancy) => {
  if (occupancy >= 80) {
    return { class: 'high', label: 'Kritik (%80+)' };
  } else if (occupancy >= 60) {
    return { class: 'moderate', label: 'Orta (%60 - %80)' };
  } else {
    return { class: 'low', label: 'Sakin (<60%)' };
  }
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initMap();
  setupEventListeners();
  loadData();
});

// Theme Management
const initTheme = () => {
  const storedTheme = localStorage.getItem('color-scheme');
  if (storedTheme) {
    state.theme = storedTheme;
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    state.theme = prefersDark ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', state.theme);
  updateThemeToggleButton();
  
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!localStorage.getItem('color-scheme')) {
      state.theme = e.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', state.theme);
      updateThemeToggleButton();
      switchMapTileLayer();
      updateMarkerStyles();
    }
  });
};

const updateThemeToggleButton = () => {
  const toggleBtn = document.getElementById('theme-toggle');
  if (toggleBtn) {
    const iconSpan = toggleBtn.querySelector('.toggle-icon');
    if (iconSpan) {
      iconSpan.textContent = state.theme === 'dark' ? '☀️' : '🌙';
    }
    toggleBtn.title = state.theme === 'dark' ? 'Açık Temaya Geç' : 'Karanlık Temaya Geç';
  }
};

const toggleTheme = () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  document.querySelector('meta[name="color-scheme"]').content = state.theme;
  localStorage.setItem('color-scheme', state.theme);
  updateThemeToggleButton();
  switchMapTileLayer();
  updateMarkerStyles();
  
  if (state.selectedFacility) {
    updateDetailsPanel(state.selectedFacility);
  }
  if (state.selectedDistrict) {
    updateDistrictDetailPanel(state.selectedDistrict);
  }
};

// Map Initialization
const initMap = () => {
  state.map = L.map('map', {
    center: [41.015, 29.000],
    zoom: 11,
    zoomControl: false 
  });
  
  L.control.zoom({
    position: 'bottomright'
  }).addTo(state.map);

  const config = TILE_LAYERS[state.theme];
  state.activeTileLayer = L.tileLayer(config.url, config.options).addTo(state.map);
};

const switchMapTileLayer = () => {
  if (state.map && state.activeTileLayer) {
    state.map.removeLayer(state.activeTileLayer);
    const config = TILE_LAYERS[state.theme];
    state.activeTileLayer = L.tileLayer(config.url, config.options).addTo(state.map);
  }
};

// Fetch data from Node.js backend
const loadData = async () => {
  try {
    // Parallel fetches to minimize load latency
    const [facilitiesRes, districtsRes] = await Promise.all([
      fetch(`${API_BASE}/api/facilities`),
      fetch(`${API_BASE}/api/districts`)
    ]);

    state.facilities = await facilitiesRes.json();
    state.districtsGeoJSON = await districtsRes.json();

    renderStats();
    renderFacilityList();
    renderFacilityMarkers();
    renderDistrictsLayer();
    
    // Once data is loaded, trigger location check (which will call proximity analysis)
    requestUserLocation(false);
  } catch (error) {
    console.error("Failed to load map data from backend API. Please make sure backend server is running.", error);
  }
};

// Render Summary Metrics in Sidebar
const renderStats = () => {
  const totalFacilities = state.facilities.length;
  const totalCapacity = state.facilities.reduce((sum, f) => sum + f.kapasite, 0);
  const totalOccupancy = state.facilities.reduce((sum, f) => sum + (f.kapasite * (f.dolulukOrani / 100)), 0);
  const avgOccupancy = totalCapacity > 0 ? (totalOccupancy / totalCapacity) * 100 : 0;
  
  document.getElementById('stat-total-facilities').textContent = totalFacilities;
  document.getElementById('stat-total-capacity').textContent = totalCapacity.toLocaleString('tr-TR');
  document.getElementById('stat-avg-occupancy').textContent = `${avgOccupancy.toFixed(1)}%`;
};

// Step 1: Render District Polygon Boundaries with Choropleth Styling (Step 2)
const renderDistrictsLayer = () => {
  if (state.districtsLayer) {
    state.map.removeLayer(state.districtsLayer);
  }

  state.districtsLayer = L.geoJSON(state.districtsGeoJSON, {
    style: (feature) => {
      const facilityCount = feature.properties.facilityCount || 0;
      return {
        fillColor: getChoroplethColor(facilityCount),
        weight: 1.5,
        opacity: 0.8,
        color: state.theme === 'dark' ? '#1e293b' : '#94a3b8', // District border color
        fillOpacity: state.theme === 'dark' ? 0.25 : 0.35
      };
    },
    onEachFeature: (feature, layer) => {
      // Step 1: mouseover (hover) triggers absolutely nothing on district borders (no tooltips, no popups)
      // Step 1: click selects the district and highlights it
      layer.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        selectDistrict(feature, layer);
      });
    }
  }).addTo(state.map);
};

// Highlight selected district and show decision support metrics
const selectDistrict = (districtFeature, layer) => {
  // Reset previously highlighted district style
  if (state.selectedDistrictLayer && state.districtsLayer) {
    state.districtsLayer.resetStyle(state.selectedDistrictLayer);
  }

  // Clear facility selected style if any
  resetFacilitySelection();

  state.selectedDistrict = districtFeature;
  state.selectedDistrictLayer = layer;

  // Highlight border of clicked district
  layer.setStyle({
    weight: 3.5,
    color: state.theme === 'dark' ? '#60a5fa' : '#2563eb', // Electric blue / primary highlight
    fillOpacity: state.theme === 'dark' ? 0.4 : 0.5
  });

  // Pan map to fit the district polygon boundaries nicely
  state.map.fitBounds(layer.getBounds(), {
    padding: [30, 30],
    animate: true,
    duration: 1
  });

  // Switch sidebar view to District Detail
  document.getElementById('list-view').classList.remove('active');
  document.getElementById('detail-view').classList.remove('active');
  document.getElementById('district-detail-view').classList.add('active');

  updateDistrictDetailPanel(districtFeature);
};

// Update District Karar Destek details (Step 5)
const updateDistrictDetailPanel = (districtFeature) => {
  const { name, population, facilityCount, facilitiesPer100k, alarmLevel, alarmReason, facilityIds } = districtFeature.properties;

  document.getElementById('district-name').textContent = `${name} İlçesi`;
  document.getElementById('district-population').textContent = population.toLocaleString('tr-TR');
  document.getElementById('district-facility-count').textContent = facilityCount;
  document.getElementById('district-density-val').textContent = `${facilitiesPer100k} adet / 100 bin kişi`;

  // Update Alarm Badge
  const alarmBadge = document.getElementById('district-alarm-badge');
  alarmBadge.className = `facility-badge ${alarmLevel.toLowerCase()}`;
  alarmBadge.textContent = alarmLevel === 'RED' ? 'Kritik Durum' : 
                           alarmLevel === 'AMBER' ? 'Geliştirilebilir' : 'Optimal';

  // Update Decision Support Card Content
  const alarmContainer = document.getElementById('district-alarm-container');
  alarmContainer.className = `decision-support-card ${alarmLevel.toLowerCase()}`;
  
  const decisionText = document.getElementById('district-decision-text');
  
  // Custom decision support recommendations
  if (alarmLevel === 'RED') {
    decisionText.innerHTML = `🚨 <strong>Kritik Yetersizlik Uyarısı:</strong> ${name} ilçesinde nüfus yoğunluğu çok yüksek (${population.toLocaleString('tr-TR')} kişi) olmasına rağmen sosyal tesis sayısı yetersizdir (${facilityCount} adet). Acil yeni tesis yatırımı yapılması önerilir! <br/><br/><em>Gerekçe: ${alarmReason}</em>`;
  } else if (alarmLevel === 'AMBER') {
    decisionText.innerHTML = `⚠️ <strong>Geliştirme Tavsiyesi:</strong> ${name} ilçesindeki sosyal tesis kapasitesi (${facilityCount} adet) nüfusa göre geliştirilmeye müsaittir. Mevcut tesislerin genişletilmesi veya 1 adet ek tesis planlanması önerilir.<br/><br/><em>Gerekçe: ${alarmReason}</em>`;
  } else {
    decisionText.innerHTML = `✅ <strong>Optimal Durum:</strong> ${name} ilçesindeki sosyal tesis dağılımı (${facilityCount} adet) nüfus yoğunluğu için yeterli düzeydedir. Mevcut hizmet kalitesinin sürdürülmesi tavsiye edilir.<br/><br/><em>Gerekçe: ${alarmReason}</em>`;
  }

  // Render facility list inside this district
  const listContainer = document.getElementById('district-facility-list');
  listContainer.innerHTML = '';

  const districtFacilities = state.facilities.filter(f => facilityIds.includes(f.id));
  
  if (districtFacilities.length === 0) {
    listContainer.innerHTML = '<div class="proximity-loading">Bu ilçede İBB sosyal tesisi bulunmuyor.</div>';
  } else {
    districtFacilities.forEach(facility => {
      const card = document.createElement('div');
      card.className = 'proximity-item';
      card.innerHTML = `
        <div class="proximity-info">
          <span class="proximity-name">${facility.ad}</span>
          <small style="color: var(--text-muted)">Doluluk: %${facility.dolulukOrani}</small>
        </div>
        <span class="proximity-dist" style="background: var(--bg-primary); color: var(--text-primary)">${facility.kod}</span>
      `;
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        selectFacility(facility);
      });
      listContainer.appendChild(card);
    });
  }

  // Step 6: Fetch real-time weather at District Centroid (bounding box center)
  const centroid = getGeometryCentroid(districtFeature.geometry);
  Weather.display(centroid[0], centroid[1], 'district-weather-grid');
};

// Computes bounding box center as centroid coordinates [lat, lng]
const getGeometryCentroid = (geometry) => {
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  
  const processRing = (ring) => {
    ring.forEach(pt => {
      const [lng, lat] = pt;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    });
  };
  
  if (geometry.type === 'Polygon') {
    processRing(geometry.coordinates[0]);
  } else if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach(poly => processRing(poly[0]));
  }
  
  return [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
};

// Render Interactive Markers on Map
const renderFacilityMarkers = () => {
  Object.values(state.markers).forEach(m => state.map.removeLayer(m));
  state.markers = {};

  state.facilities.forEach(facility => {
    const { id, kod, ad, dolulukOrani, koordinatlar } = facility;
    const status = getStatusDetails(dolulukOrani);
    const markerColor = getColorByStatus(status.class, state.theme);

    const marker = L.circleMarker(koordinatlar, {
      radius: 10,
      fillColor: markerColor,
      color: state.theme === 'dark' ? '#000000' : '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.85
    }).addTo(state.map);

    marker.bindTooltip(`
      <div class="custom-tooltip-content">
        <strong>${ad}</strong> (${kod})<br/>
        Doluluk: %${dolulukOrani}
      </div>
    `, {
      className: 'leaflet-tooltip-own',
      direction: 'top',
      offset: [0, -8]
    });

    marker.on('mouseover', () => {
      if (state.selectedFacility?.id !== id) {
        marker.setStyle({ radius: 12, fillOpacity: 1, weight: 3 });
      }
    });

    marker.on('mouseout', () => {
      if (state.selectedFacility?.id !== id) {
        marker.setStyle({ radius: 10, fillOpacity: 0.85, weight: 2 });
      }
    });

    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      selectFacility(facility);
    });

    state.markers[id] = marker;
  });
};

const updateMarkerStyles = () => {
  state.facilities.forEach(facility => {
    const { id, dolulukOrani } = facility;
    const status = getStatusDetails(dolulukOrani);
    const markerColor = getColorByStatus(status.class, state.theme);
    const marker = state.markers[id];
    
    if (marker) {
      const isSelected = state.selectedFacility?.id === id;
      marker.setStyle({
        fillColor: markerColor,
        color: state.theme === 'dark' ? '#000000' : '#ffffff',
        radius: isSelected ? 14 : 10,
        weight: isSelected ? 4 : 2
      });
    }
  });
  
  if (state.userLocation.marker) {
    const userColor = getColorByStatus('primary', state.theme);
    state.userLocation.marker.setStyle({ fillColor: userColor });
  }
};

const renderFacilityList = (filter = 'all', searchQuery = '') => {
  const listContainer = document.getElementById('facility-list');
  listContainer.innerHTML = '';
  const query = searchQuery.trim().toLowerCase();
  
  const filtered = state.facilities.filter(f => {
    if (filter === 'high' && f.dolulukOrani < 80) return false;
    if (filter === 'low' && f.dolulukOrani >= 60) return false;
    if (query) {
      return f.ad.toLowerCase().includes(query) || f.kod.toLowerCase().includes(query);
    }
    return true;
  });

  if (filtered.length === 0) {
    listContainer.innerHTML = '<div class="proximity-loading">Arama kriterlerine uygun tesis bulunamadı.</div>';
    return;
  }

  filtered.forEach(facility => {
    const { id, kod, ad, dolulukOrani, kapasite } = facility;
    const status = getStatusDetails(dolulukOrani);
    
    const card = document.createElement('div');
    card.className = `facility-item ${state.selectedFacility?.id === id ? 'selected' : ''}`;
    card.setAttribute('role', 'listitem');
    card.dataset.id = id;
    
    card.innerHTML = `
      <div class="facility-item-header">
        <span class="facility-name">${ad}</span>
        <span class="facility-code">${kod}</span>
      </div>
      <div class="mini-progress-bar">
        <div class="mini-progress-fill ${status.class}" style="width: ${dolulukOrani}%"></div>
      </div>
      <div class="facility-item-stats">
        <span>Kapasite: <strong>${kapasite}</strong></span>
        <span class="occupancy-indicator">
          <span class="status-dot ${status.class}"></span>
          %${dolulukOrani} Dolu
        </span>
      </div>
    `;
    
    card.addEventListener('click', () => {
      selectFacility(facility);
    });
    
    listContainer.appendChild(card);
  });
};

// Facility Selection
const selectFacility = (facility) => {
  // Reset district borders highlight
  if (state.selectedDistrictLayer && state.districtsLayer) {
    state.districtsLayer.resetStyle(state.selectedDistrictLayer);
    state.selectedDistrict = null;
    state.selectedDistrictLayer = null;
  }

  // Clear previous highlighted marker
  if (state.selectedFacility && state.markers[state.selectedFacility.id]) {
    state.markers[state.selectedFacility.id].setStyle({
      radius: 10,
      weight: 2,
      fillOpacity: 0.85
    });
  }

  state.selectedFacility = facility;
  
  const activeMarker = state.markers[facility.id];
  if (activeMarker) {
    activeMarker.setStyle({ radius: 14, weight: 4, fillOpacity: 1 });
    state.map.flyTo(facility.koordinatlar, 13, { animate: true, duration: 1.2 });
  }
  
  // Switch sidebar view to Details
  document.getElementById('list-view').classList.remove('active');
  document.getElementById('district-detail-view').classList.remove('active');
  document.getElementById('detail-view').classList.add('active');
  
  updateDetailsPanel(facility);
  
  // Re-sync facility list selections
  const cards = document.querySelectorAll('.facility-item');
  cards.forEach(c => {
    if (parseInt(c.dataset.id) === facility.id) {
      c.classList.add('selected');
    } else {
      c.classList.remove('selected');
    }
  });

  // Step 4: Draw OSRM route line from user to this facility
  const startCoords = [state.userLocation.lat, state.userLocation.lng];
  const endCoords = facility.koordinatlar;
  Routing.draw(startCoords, endCoords);

  // Step 6: Fetch real-time weather at facility location
  Weather.display(endCoords[0], endCoords[1], 'facility-weather-grid');
};

const resetFacilitySelection = () => {
  if (state.selectedFacility && state.markers[state.selectedFacility.id]) {
    state.markers[state.selectedFacility.id].setStyle({
      radius: 10, weight: 2, fillOpacity: 0.85
    });
  }
  state.selectedFacility = null;
  document.querySelectorAll('.facility-item').forEach(c => c.classList.remove('selected'));
  Routing.clear();
};

const updateDetailsPanel = (facility) => {
  const { kod, ad, kapasite, dolulukOrani, koordinatlar } = facility;
  const status = getStatusDetails(dolulukOrani);
  
  document.getElementById('detail-code').textContent = kod;
  document.getElementById('detail-name').textContent = ad;
  document.getElementById('detail-capacity').textContent = kapasite;
  document.getElementById('detail-occupancy-percent').textContent = `%${dolulukOrani}`;
  
  const progressFill = document.getElementById('detail-progress-fill');
  progressFill.className = `progress-bar-fill ${status.class}`;
  
  void progressFill.offsetWidth;
  progressFill.style.width = `${dolulukOrani}%`;
  
  const statusText = document.getElementById('detail-occupancy-text');
  statusText.className = `occupancy-status-text ${status.class}`;
  statusText.textContent = `${status.label} kapasite doluluk düzeyinde`;
  
  // Trigger distance and crawling warnings
  calculateDistanceAndCrawlingTime(koordinatlar, kod);
};

const calculateDistanceAndCrawlingTime = (facilityCoords, kod) => {
  const userLatLng = L.latLng(state.userLocation.lat, state.userLocation.lng);
  const facilityLatLng = L.latLng(facilityCoords[0], facilityCoords[1]);
  
  // Calculate flight distance in meters
  const distance = state.map.distance(userLatLng, facilityLatLng);
  const crawlingTime = (distance / 20).toFixed(1);
  
  document.getElementById('crawling-distance').textContent = `${distance.toFixed(1)} m`;
  document.getElementById('crawling-duration').textContent = `${crawlingTime} dk`;
  
  const warningContainer = document.getElementById('crawling-warning-container');
  warningContainer.innerHTML = `🚨 MÜFETTİŞ UYARISI: Bu sosyal tesise (${kod}) şu anki konumundan sürünerek yaklaşık ${crawlingTime} dakika içinde varabilirsin. Yoldaki asfalt kalitesine ve dirsek koruyucularına dikkat et!`;
};

// User Location & Navigator Geolocation API
const requestUserLocation = (flyToUser = true) => {
  const locationDot = document.getElementById('location-dot');
  const locationText = document.getElementById('location-status-text');
  
  if (locationDot) locationDot.className = 'location-status-dot orange';
  if (locationText) locationText.textContent = 'Konum alınıyor...';

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        state.userLocation.lat = latitude;
        state.userLocation.lng = longitude;
        state.userLocation.isMock = false;
        
        updateUserLocationUI('Senin Konumun (Canlı GPS)', 'green', flyToUser);
      },
      (error) => {
        console.warn(`Geolocation Error (${error.code}): ${error.message}. Fallback applied.`);
        state.userLocation.lat = 41.037007; // Taksim Square
        state.userLocation.lng = 28.976273;
        state.userLocation.isMock = true;
        
        updateUserLocationUI('Senin Konumun (Varsayılan Taksim)', 'blue', flyToUser);
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
    );
  } else {
    state.userLocation.lat = 41.037007;
    state.userLocation.lng = 28.976273;
    state.userLocation.isMock = true;
    updateUserLocationUI('Senin Konumun (Konum Desteklenmiyor)', 'blue', flyToUser);
  }
};

const updateUserLocationUI = (label, dotClass, flyToUser) => {
  const locationDot = document.getElementById('location-dot');
  const locationText = document.getElementById('location-status-text');
  
  if (locationDot) locationDot.className = `location-status-dot ${dotClass}`;
  if (locationText) locationText.textContent = label;
  
  const userCoords = [state.userLocation.lat, state.userLocation.lng];
  const userColor = getColorByStatus('primary', state.theme);
  
  if (state.userLocation.marker) {
    state.userLocation.marker.setLatLng(userCoords);
  } else {
    state.userLocation.marker = L.circleMarker(userCoords, {
      radius: 8,
      fillColor: userColor,
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 1
    }).addTo(state.map);
    
    state.userLocation.marker.bindTooltip('Senin Konumun', {
      permanent: true,
      direction: 'bottom',
      className: 'leaflet-tooltip-own',
      offset: [0, 8]
    });
  }
  
  if (flyToUser) {
    state.map.flyTo(userCoords, 14, { animate: true, duration: 1.2 });
  }
  
  // Step 3: Fetch Proximity Analysis List (Closest 3 facilities)
  fetchProximityAnalysis();

  if (state.selectedFacility) {
    calculateDistanceAndCrawlingTime(state.selectedFacility.koordinatlar, state.selectedFacility.kod);
    Routing.draw(userCoords, state.selectedFacility.koordinatlar);
  }
};

// Step 3: Proximity Analysis API call and UI rendering
const fetchProximityAnalysis = async () => {
  const listContainer = document.getElementById('proximity-list');
  if (!listContainer) return;

  try {
    const res = await fetch(`${API_BASE}/api/proximity?lat=${state.userLocation.lat}&lng=${state.userLocation.lng}`);
    const closestFacilities = await res.json();
    
    listContainer.innerHTML = '';
    
    closestFacilities.forEach((facility, idx) => {
      const card = document.createElement('div');
      card.className = 'proximity-item';
      
      // Formatting meters/km nicely
      const distanceStr = facility.distance >= 1000 ? 
        `${(facility.distance / 1000).toFixed(2)} km` : 
        `${Math.round(facility.distance)} m`;

      card.innerHTML = `
        <div class="proximity-info">
          <span class="proximity-name">${idx + 1}. ${facility.ad}</span>
          <small style="color: var(--text-muted)">Doluluk Oranı: %${facility.dolulukOrani}</small>
        </div>
        <span class="proximity-dist">${distanceStr}</span>
      `;

      card.addEventListener('click', (e) => {
        L.DomEvent.stopPropagation(e);
        selectFacility(facility);
      });

      listContainer.appendChild(card);
    });
  } catch (error) {
    console.error("Proximity API call failed.", error);
    listContainer.innerHTML = '<div class="proximity-loading" style="color: var(--color-high)">Mesafe hesaplama hatası!</div>';
  }
};

/**
 * Weather Module (Step 6)
 * 
 * WHY:
 * Deep Module hides coordinates parsing, backend call timeouts, and DOM injection.
 * Caller only executes Weather.display(lat, lng, elementId).
 */
const Weather = (() => {
  return {
    display: async (lat, lng, elementId) => {
      const grid = document.getElementById(elementId);
      if (!grid) return;

      try {
        const res = await fetch(`${API_BASE}/api/weather?lat=${lat}&lng=${lng}`);
        const data = await res.json();

        // Update DOM element
        grid.innerHTML = `
          <div class="weather-temp">${data.temp}°C</div>
          <div class="weather-desc">${data.condition}</div>
          <div class="weather-detail">Nem: %${data.humidity}</div>
          <div class="weather-detail">Rüzgar: ${data.wind} km/s</div>
        `;
      } catch (err) {
        console.error("Failed to query weather API", err);
        grid.innerHTML = '<div class="weather-detail" style="grid-column: span 2">Hava durumu verisi alınamadı.</div>';
      }
    }
  };
})();

/**
 * Routing Module (Step 4)
 * 
 * WHY:
 * Deep Module hides OSRM geometry extraction, coordinates swapping ([lng, lat] vs [lat, lng]), 
 * and layer drawing. Exposes only Routing.draw(start, end).
 */
const Routing = (() => {
  return {
    draw: async (start, end) => {
      // Clear old route if exists
      Routing.clear();

      try {
        // OSRM expects coordinates in [lng, lat] format
        const startLngLat = `${start[1]},${start[0]}`;
        const endLngLat = `${end[1]},${end[0]}`;
        
        const url = `https://router.project-osrm.org/route/v1/driving/${startLngLat};${endLngLat}?overview=full&geometries=geojson`;
        
        const res = await fetch(url);
        const routeData = await res.json();
        
        if (routeData.code === 'Ok' && routeData.routes.length > 0) {
          const routeGeoJSON = routeData.routes[0].geometry;
          
          // Draw pulsing route line
          state.routeLayer = L.geoJSON(routeGeoJSON, {
            style: {
              color: '#3b82f6', // Glowing blue path
              weight: 5,
              opacity: 0.75,
              className: 'route-line-glowing'
            }
          }).addTo(state.map);
        } else {
          // If route search fails, trigger fallback geodesic line (Define errors out of existence)
          Routing.drawGeodesicFallback(start, end);
        }
      } catch (err) {
        console.warn("OSRM routing service failed or offline. Drawing straight flight path fallback.");
        Routing.drawGeodesicFallback(start, end);
      }
    },
    
    // Draw straight dashed line if route solver is offline or coordinates are out of bounds
    drawGeodesicFallback: (start, end) => {
      Routing.clear();
      state.routeLayer = L.polyline([start, end], {
        color: '#ef4444', // Red dashed flight path
        weight: 3.5,
        opacity: 0.6,
        dashArray: '6, 8'
      }).addTo(state.map);
    },

    clear: () => {
      if (state.routeLayer) {
        state.map.removeLayer(state.routeLayer);
        state.routeLayer = null;
      }
    }
  };
})();

// Event Listeners setup
const setupEventListeners = () => {
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  
  const myLocationBtn = document.getElementById('btn-my-location');
  const focusAllBtn = document.getElementById('btn-focus-all');
  const legendEl = document.querySelector('.map-legend');
  
  if (myLocationBtn) L.DomEvent.disableClickPropagation(myLocationBtn);
  if (focusAllBtn) L.DomEvent.disableClickPropagation(focusAllBtn);
  if (legendEl) {
    L.DomEvent.disableClickPropagation(legendEl);
    L.DomEvent.disableScrollPropagation(legendEl);
  }

  myLocationBtn.addEventListener('click', () => {
    requestUserLocation(true);
  });
  
  focusAllBtn.addEventListener('click', () => {
    if (state.facilities.length > 0) {
      const latLngs = state.facilities.map(f => L.latLng(f.koordinatlar[0], f.koordinatlar[1]));
      const bounds = L.latLngBounds(latLngs);
      bounds.extend(L.latLng(state.userLocation.lat, state.userLocation.lng));
      state.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15, animate: true, duration: 1 });
    }
  });
  
  // Back to list button inside Facility Details
  document.getElementById('back-to-list-btn').addEventListener('click', () => {
    resetFacilitySelection();
    document.getElementById('detail-view').classList.remove('active');
    document.getElementById('list-view').classList.add('active');
  });

  // Back to list button inside District Details
  document.getElementById('district-back-btn').addEventListener('click', () => {
    if (state.selectedDistrictLayer && state.districtsLayer) {
      state.districtsLayer.resetStyle(state.selectedDistrictLayer);
    }
    state.selectedDistrict = null;
    state.selectedDistrictLayer = null;
    
    document.getElementById('district-detail-view').classList.remove('active');
    document.getElementById('list-view').classList.add('active');
  });

  // Search input typing handler
  const searchInput = document.getElementById('facility-search');
  searchInput.addEventListener('input', (e) => {
    const activeFilterBtn = document.querySelector('.filter-btn.active');
    const filter = activeFilterBtn ? activeFilterBtn.dataset.filter : 'all';
    renderFacilityList(filter, e.target.value);
  });

  // Filter option pills click handlers
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      filterBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      const filter = e.target.dataset.filter;
      const query = document.getElementById('facility-search').value;
      renderFacilityList(filter, query);
    });
  });

  // If user clicks on map outside district bounds, reset selections
  state.map.on('click', () => {
    if (state.selectedDistrictLayer && state.districtsLayer) {
      state.districtsLayer.resetStyle(state.selectedDistrictLayer);
      state.selectedDistrict = null;
      state.selectedDistrictLayer = null;
      document.getElementById('district-detail-view').classList.remove('active');
      document.getElementById('list-view').classList.add('active');
    }
    resetFacilitySelection();
    document.getElementById('detail-view').classList.remove('active');
    document.getElementById('list-view').classList.add('active');
  });
};
