// Core Application State
const state = {
  facilities: [],
  selectedFacility: null,
  userLocation: {
    lat: 41.037007, // Taksim Square fallback latitude
    lng: 28.976273, // Taksim Square fallback longitude
    isMock: true,
    marker: null
  },
  map: null,
  activeTileLayer: null,
  theme: 'light',
  markers: {} // facilityId -> Leaflet marker object
};

// Tile Layer configurations (CartoDB Positron for light, Dark Matter for dark)
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

// Mock Social Facilities Data
const MOCK_FACILITIES = [
  {
    id: 1,
    kod: "ALTY-01",
    ad: "Altınboynuz Sosyal Tesisi",
    kapasite: 120,
    dolulukOrani: 75,
    koordinatlar: [41.0578458, 28.9456101]
  },
  {
    id: 2,
    kod: "ALTY-02",
    ad: "Arnavutköy Sosyal Tesisi",
    kapasite: 150,
    dolulukOrani: 85,
    koordinatlar: [41.067491, 29.0448903]
  },
  {
    id: 3,
    kod: "ALTY-03",
    ad: "Avcılar Sosyal Tesisi",
    kapasite: 200,
    dolulukOrani: 55,
    koordinatlar: [40.976648, 28.743912]
  },
  {
    id: 4,
    kod: "ALTY-04",
    ad: "Beykoz Koru Sosyal Tesisi",
    kapasite: 250,
    dolulukOrani: 90,
    koordinatlar: [41.1316936, 29.0942223]
  },
  {
    id: 5,
    kod: "ALTY-05",
    ad: "Beykoz Sahil Sosyal Tesisi",
    kapasite: 180,
    dolulukOrani: 65,
    koordinatlar: [41.1134095, 29.0864284]
  },
  {
    id: 6,
    kod: "ALTY-06",
    ad: "Boğazköy Sosyal Tesisi",
    kapasite: 110,
    dolulukOrani: 40,
    koordinatlar: [41.185797, 28.765582]
  },
  {
    id: 7,
    kod: "ALTY-07",
    ad: "Çamlıca Sosyal Tesisi",
    kapasite: 300,
    dolulukOrani: 95,
    koordinatlar: [41.027788, 29.069052]
  },
  {
    id: 8,
    kod: "ALTY-08",
    ad: "Cihangir Sosyal Tesisi",
    kapasite: 90,
    dolulukOrani: 72,
    koordinatlar: [41.0284966, 28.9825361]
  },
  {
    id: 9,
    kod: "ALTY-09",
    ad: "Dragos Sosyal Tesisi",
    kapasite: 220,
    dolulukOrani: 83,
    koordinatlar: [40.9013477, 29.1466597]
  },
  {
    id: 10,
    kod: "ALTY-10",
    ad: "Fethipaşa Sosyal Tesisi",
    kapasite: 280,
    dolulukOrani: 89,
    koordinatlar: [41.0333739, 29.0259101]
  },
  {
    id: 11,
    kod: "ALTY-11",
    ad: "Florya Sosyal Tesisi",
    kapasite: 350,
    dolulukOrani: 91,
    koordinatlar: [40.960613, 28.807588]
  },
  {
    id: 12,
    kod: "ALTY-12",
    ad: "Gazi Sosyal Tesisi",
    kapasite: 130,
    dolulukOrani: 58,
    koordinatlar: [41.101274, 28.916913]
  },
  {
    id: 13,
    kod: "ALTY-13",
    ad: "Gözdağı Sosyal Tesisi",
    kapasite: 160,
    dolulukOrani: 74,
    koordinatlar: [40.8906409, 29.2536092]
  },
  {
    id: 14,
    kod: "ALTY-14",
    ad: "Haliç Sosyal Tesisi",
    kapasite: 180,
    dolulukOrani: 62,
    koordinatlar: [41.028283, 28.957092]
  },
  {
    id: 15,
    kod: "ALTY-15",
    ad: "İstinye Sosyal Tesisi",
    kapasite: 200,
    dolulukOrani: 80,
    koordinatlar: [41.1147873, 29.0549822]
  },
  {
    id: 16,
    kod: "ALTY-16",
    ad: "Kasımpaşa Sosyal Tesisi",
    kapasite: 140,
    dolulukOrani: 48,
    koordinatlar: [41.0299569, 28.9667688]
  },
  {
    id: 17,
    kod: "ALTY-17",
    ad: "Küçük Çamlıca Sosyal Tesisi",
    kapasite: 210,
    dolulukOrani: 67,
    koordinatlar: [41.016344, 29.064013]
  },
  {
    id: 18,
    kod: "ALTY-18",
    ad: "Küçükçekmece Sosyal Tesisi",
    kapasite: 170,
    dolulukOrani: 53,
    koordinatlar: [40.9998227, 28.765311]
  },
  {
    id: 19,
    kod: "ALTY-19",
    ad: "Safa Tepesi Sosyal Tesisi",
    kapasite: 190,
    dolulukOrani: 79,
    koordinatlar: [41.0137496, 29.2547994]
  },
  {
    id: 20,
    kod: "ALTY-20",
    ad: "Sultanbeyli Sosyal Tesisi",
    kapasite: 240,
    dolulukOrani: 86,
    koordinatlar: [40.954071, 29.276533]
  },
  {
    id: 21,
    kod: "ALTY-21",
    ad: "Yakuplu Sosyal Tesisi",
    kapasite: 150,
    dolulukOrani: 45,
    koordinatlar: [41.0036611, 28.6677748]
  },
  {
    id: 22,
    kod: "ALTY-22",
    ad: "Beykoz Kır Bahçesi Sosyal Tesisi",
    kapasite: 280,
    dolulukOrani: 82,
    koordinatlar: [41.134419, 29.1006]
  },
  {
    id: 23,
    kod: "ALTY-23",
    ad: "Pembe Köşk Sosyal Tesisi",
    kapasite: 120,
    dolulukOrani: 94,
    koordinatlar: [41.109894, 29.05697]
  },
  {
    id: 24,
    kod: "ALTY-24",
    ad: "Kır Kahvesi Sosyal Tesisi",
    kapasite: 100,
    dolulukOrani: 70,
    koordinatlar: [41.0479649, 29.0131607]
  },
  {
    id: 25,
    kod: "ALTY-25",
    ad: "Paşalimanı Sosyal Tesisi",
    kapasite: 160,
    dolulukOrani: 88,
    koordinatlar: [41.032235, 29.022992]
  },
  {
    id: 26,
    kod: "ALTY-26",
    ad: "Florya Yerleşim Birimleri",
    kapasite: 320,
    dolulukOrani: 50,
    koordinatlar: [40.971945, 28.788689]
  },
  {
    id: 27,
    kod: "ALTY-27",
    ad: "Zeytinburnu Sosyal Tesisi",
    kapasite: 200,
    dolulukOrani: 73,
    koordinatlar: [40.9850535, 28.906515]
  },
  {
    id: 28,
    kod: "ALTY-28",
    ad: "1453 Çırpıcı Sosyal Tesisi",
    kapasite: 300,
    dolulukOrani: 61,
    koordinatlar: [41.0003203, 28.8892505]
  },
  {
    id: 29,
    kod: "ALTY-29",
    ad: "Denizköşk Sosyal Tesisi",
    kapasite: 190,
    dolulukOrani: 59,
    koordinatlar: [40.974184, 28.743431]
  },
  {
    id: 30,
    kod: "ALTY-30",
    ad: "Güngören Sosyal Tesisi",
    kapasite: 140,
    dolulukOrani: 66,
    koordinatlar: [41.0363577, 28.871629]
  }
];

// Helper to determine status color based on occupancy percentage
const getStatusDetails = (occupancy) => {
  if (occupancy >= 80) {
    return { class: 'high', label: 'Kritik (%80+)' };
  } else if (occupancy >= 60) {
    return { class: 'moderate', label: 'Orta (%60 - %80)' };
  } else {
    return { class: 'low', label: 'Sakin (<60%)' };
  }
};

// Retrieve color values dynamically based on theme and status
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

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  state.facilities = [...MOCK_FACILITIES];
  initTheme();
  initMap();
  renderStats();
  renderFacilityList();
  setupEventListeners();
  requestUserLocation(false); // Initial location check silently
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
  
  // Watch for system theme changes
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
  
  // Rerender details panel progress bar & occupancy status classes if active
  if (state.selectedFacility) {
    updateDetailsPanel(state.selectedFacility);
  }
};

// Map Initialization
const initMap = () => {
  // Center map on Istanbul
  state.map = L.map('map', {
    center: [41.015, 29.000],
    zoom: 11,
    zoomControl: false // We will use custom premium glassy controls
  });
  
  // Add professional zoom controls in the bottom-right corner
  L.control.zoom({
    position: 'bottomright'
  }).addTo(state.map);

  // Set initial Tile Layer based on theme
  const config = TILE_LAYERS[state.theme];
  state.activeTileLayer = L.tileLayer(config.url, config.options).addTo(state.map);
  
  // Render facilities on map
  renderFacilityMarkers();
};

const switchMapTileLayer = () => {
  if (state.map && state.activeTileLayer) {
    state.map.removeLayer(state.activeTileLayer);
    const config = TILE_LAYERS[state.theme];
    state.activeTileLayer = L.tileLayer(config.url, config.options).addTo(state.map);
  }
};

// Stats Calculation & Display
const renderStats = () => {
  const totalFacilities = state.facilities.length;
  const totalCapacity = state.facilities.reduce((sum, f) => sum + f.kapasite, 0);
  const totalOccupancy = state.facilities.reduce((sum, f) => sum + (f.kapasite * (f.dolulukOrani / 100)), 0);
  const avgOccupancy = totalCapacity > 0 ? (totalOccupancy / totalCapacity) * 100 : 0;
  
  document.getElementById('stat-total-facilities').textContent = totalFacilities;
  document.getElementById('stat-total-capacity').textContent = totalCapacity.toLocaleString('tr-TR');
  document.getElementById('stat-avg-occupancy').textContent = `${avgOccupancy.toFixed(1)}%`;
};

// Render Interactive Markers on Map
const renderFacilityMarkers = () => {
  // Clear any existing markers
  Object.values(state.markers).forEach(m => state.map.removeLayer(m));
  state.markers = {};

  state.facilities.forEach(facility => {
    // ES6 Destructuring to extract facility attributes
    const { id, kod, ad, dolulukOrani, koordinatlar } = facility;
    const status = getStatusDetails(dolulukOrani);
    const markerColor = getColorByStatus(status.class, state.theme);

    // Create interactive circle marker
    const marker = L.circleMarker(koordinatlar, {
      radius: 10,
      fillColor: markerColor,
      color: state.theme === 'dark' ? '#000000' : '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.85
    }).addTo(state.map);

    // Bind custom glassy tooltip on hover
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

    // Hover events for premium micro-animations
    marker.on('mouseover', () => {
      if (state.selectedFacility?.id !== id) {
        marker.setStyle({
          radius: 12,
          fillOpacity: 1,
          weight: 3
        });
      }
    });

    marker.on('mouseout', () => {
      if (state.selectedFacility?.id !== id) {
        marker.setStyle({
          radius: 10,
          fillOpacity: 0.85,
          weight: 2
        });
      }
    });

    // Click event to inspect facility
    marker.on('click', () => {
      selectFacility(facility);
    });

    // Save reference to marker
    state.markers[id] = marker;
  });
};

// Dynamic Marker Style Updates (Triggered on Theme toggle)
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
  
  // Also update user marker style
  if (state.userLocation.marker) {
    const userColor = getColorByStatus('primary', state.theme);
    state.userLocation.marker.setStyle({
      fillColor: userColor
    });
  }
};

// Render Facility Card List
const renderFacilityList = (filter = 'all', searchQuery = '') => {
  const listContainer = document.getElementById('facility-list');
  listContainer.innerHTML = '';
  
  const query = searchQuery.trim().toLowerCase();
  
  const filtered = state.facilities.filter(f => {
    // Filter by capacity status
    if (filter === 'high' && f.dolulukOrani < 80) return false;
    if (filter === 'low' && f.dolulukOrani >= 60) return false;
    
    // Filter by search query
    if (query) {
      const nameMatch = f.ad.toLowerCase().includes(query);
      const codeMatch = f.kod.toLowerCase().includes(query);
      return nameMatch || codeMatch;
    }
    
    return true;
  });

  if (filtered.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-list-state">
        <p>Arama kriterlerine uygun tesis bulunamadı.</p>
      </div>
    `;
    return;
  }

  filtered.forEach(facility => {
    // ES6 Destructuring
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

// Facility Selection & UI Transition
const selectFacility = (facility) => {
  // Reset previous selection styles
  if (state.selectedFacility && state.markers[state.selectedFacility.id]) {
    const prevFacility = state.selectedFacility;
    const prevStatus = getStatusDetails(prevFacility.dolulukOrani);
    state.markers[prevFacility.id].setStyle({
      radius: 10,
      weight: 2,
      fillOpacity: 0.85
    });
  }

  state.selectedFacility = facility;
  
  // Highlight active marker
  const activeMarker = state.markers[facility.id];
  if (activeMarker) {
    activeMarker.setStyle({
      radius: 14,
      weight: 4,
      fillOpacity: 1
    });
    
    // Zoom and pan to facility marker
    state.map.flyTo(facility.koordinatlar, 13, {
      animate: true,
      duration: 1.2
    });
  }
  
  // Switch sidebar view to Details
  document.getElementById('list-view').classList.remove('active');
  document.getElementById('detail-view').classList.add('active');
  
  // Update details data representation
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
};

// Update Facility Details Sidebar Panel
const updateDetailsPanel = (facility) => {
  const { kod, ad, kapasite, dolulukOrani, koordinatlar } = facility;
  const status = getStatusDetails(dolulukOrani);
  
  document.getElementById('detail-code').textContent = kod;
  document.getElementById('detail-name').textContent = ad;
  document.getElementById('detail-capacity').textContent = kapasite;
  document.getElementById('detail-occupancy-percent').textContent = `%${dolulukOrani}`;
  
  // Animate progress bar fill
  const progressFill = document.getElementById('detail-progress-fill');
  progressFill.className = `progress-bar-fill ${status.class}`;
  
  // Force reflow for animation
  void progressFill.offsetWidth;
  progressFill.style.width = `${dolulukOrani}%`;
  
  // Set occupancy descriptive label
  const statusText = document.getElementById('detail-occupancy-text');
  statusText.className = `occupancy-status-text ${status.class}`;
  statusText.textContent = `${status.label} kapasite doluluk düzeyinde`;
  
  // Trigger distance calculations
  calculateDistanceAndCrawlingTime(koordinatlar, kod);
};

// Calculate spatial distance and gamification crawling speed
const calculateDistanceAndCrawlingTime = (facilityCoords, kod) => {
  const userLatLng = L.latLng(state.userLocation.lat, state.userLocation.lng);
  const facilityLatLng = L.latLng(facilityCoords[0], facilityCoords[1]);
  
  // Calculate flight distance using native Leaflet map.distance in meters
  const distance = state.map.distance(userLatLng, facilityLatLng);
  
  // Crawling Speed calculation: 20 meters per minute (1.2 km/h)
  const crawlingTime = (distance / 20).toFixed(1);
  
  // UI Display
  document.getElementById('crawling-distance').textContent = `${distance.toFixed(1)} m`;
  document.getElementById('crawling-duration').textContent = `${crawlingTime} dk`;
  
  // Humorous MÜFETTİŞ UYARISI warning text matching requested format string
  const warningContainer = document.getElementById('crawling-warning-container');
  warningContainer.innerHTML = `🚨 MÜFETTİŞ UYARISI: Bu sosyal tesise (${kod}) şu anki konumundan sürünerek yaklaşık ${crawlingTime} dakika içinde varabilirsin. Yoldaki asfalt kalitesine ve dirsek koruyucularına dikkat et!`;
};

// User Location & Navigator Geolocation API
const requestUserLocation = (flyToUser = true) => {
  const locationDot = document.getElementById('location-dot');
  const locationText = document.getElementById('location-status-text');
  
  if (locationDot) {
    locationDot.className = 'location-status-dot orange';
  }
  if (locationText) {
    locationText.textContent = 'Konum alınıyor...';
  }

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      // Success Callback
      (position) => {
        const { latitude, longitude } = position.coords;
        state.userLocation.lat = latitude;
        state.userLocation.lng = longitude;
        state.userLocation.isMock = false;
        
        updateUserLocationUI('Senin Konumun (Canlı GPS)', 'green', flyToUser);
      },
      // Error Callback (Graceful Fallback to Taksim Square)
      (error) => {
        console.warn(`Geolocation Error (${error.code}): ${error.message}. Fallback applied.`);
        // Revert to designated mock coordinates (Taksim Square)
        state.userLocation.lat = 41.037007;
        state.userLocation.lng = 28.976273;
        state.userLocation.isMock = true;
        
        updateUserLocationUI('Senin Konumun (Varsayılan Taksim)', 'blue', flyToUser);
      },
      // Settings
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
    );
  } else {
    // Geolocation not supported by browser
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
  
  // Render or update User Position Pin on Map
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
    
    // Add pulsing effect via special CSS if possible, else rely on clear distinct tooltip
    state.userLocation.marker.bindTooltip('Senin Konumun', {
      permanent: true,
      direction: 'bottom',
      className: 'leaflet-tooltip-own',
      offset: [0, 8]
    });
  }
  
  // Fly to user coordinates on map if requested
  if (flyToUser) {
    state.map.flyTo(userCoords, 14, {
      animate: true,
      duration: 1.2
    });
  }
  
  // If a facility is currently selected, recalculate distance parameters instantly
  if (state.selectedFacility) {
    calculateDistanceAndCrawlingTime(state.selectedFacility.koordinatlar, state.selectedFacility.kod);
  }
};

// Event Listeners setup
const setupEventListeners = () => {
  // Theme button toggle event listener
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  
  // Disable map click/scroll propagation for custom controls inside the map container
  const myLocationBtn = document.getElementById('btn-my-location');
  const focusAllBtn = document.getElementById('btn-focus-all');
  const legendEl = document.querySelector('.map-legend');
  
  if (myLocationBtn) L.DomEvent.disableClickPropagation(myLocationBtn);
  if (focusAllBtn) L.DomEvent.disableClickPropagation(focusAllBtn);
  if (legendEl) {
    L.DomEvent.disableClickPropagation(legendEl);
    L.DomEvent.disableScrollPropagation(legendEl);
  }

  // Floating Controls: Find My Location click event
  myLocationBtn.addEventListener('click', () => {
    requestUserLocation(true);
  });
  
  // Floating Controls: Focus All Facilities click event
  focusAllBtn.addEventListener('click', () => {
    if (state.facilities.length > 0) {
      const latLngs = state.facilities.map(f => L.latLng(f.koordinatlar[0], f.koordinatlar[1]));
      const bounds = L.latLngBounds(latLngs);
      
      // Include user location in fitting bounds as well
      bounds.extend(L.latLng(state.userLocation.lat, state.userLocation.lng));
      
      state.map.fitBounds(bounds, {
        padding: [50, 50],
        maxZoom: 15,
        animate: true,
        duration: 1
      });
    }
  });
  
  // Details view back to list button
  document.getElementById('back-to-list-btn').addEventListener('click', () => {
    // Reset selected marker scale
    if (state.selectedFacility && state.markers[state.selectedFacility.id]) {
      state.markers[state.selectedFacility.id].setStyle({
        radius: 10,
        weight: 2,
        fillOpacity: 0.85
      });
    }
    
    state.selectedFacility = null;
    
    // De-select cards in sidebar
    document.querySelectorAll('.facility-item').forEach(c => c.classList.remove('selected'));
    
    // Switch views
    document.getElementById('detail-view').classList.remove('active');
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
      // Toggle active states
      filterBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      
      // Trigger rendering with new filters
      const filter = e.target.dataset.filter;
      const query = document.getElementById('facility-search').value;
      renderFacilityList(filter, query);
    });
  });
};
