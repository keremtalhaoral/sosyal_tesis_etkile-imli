/**
 * MatrixEngine - Linear Algebra & Spatial Optimization Library
 * Implements high-performance matrix-vector operations, geocentric 3D coordinate projection,
 * and TOPSIS Multi-Criteria Decision Support calculations.
 */
const MatrixEngine = (() => {
  // Convert spherical coordinates (lat, lng in degrees) to 3D Cartesian Cartesian vector [x, y, z] on unit sphere
  const toCartesianVector = (lat, lng) => {
    const radLat = (lat * Math.PI) / 180;
    const radLng = (lng * Math.PI) / 180;
    return [
      Math.cos(radLat) * Math.cos(radLng),
      Math.cos(radLat) * Math.sin(radLng),
      Math.sin(radLat)
    ];
  };

  // Perform matrix-vector multiplication: M (n x 3) * V (3 x 1) -> R (n x 1)
  // Computes cosine similarity values for proximity analysis
  const multiplyMatrixVector = (matrix, vector) => {
    const result = new Float64Array(matrix.length);
    for (let i = 0; i < matrix.length; i++) {
      const row = matrix[i];
      result[i] = row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2];
    }
    return result;
  };

  /**
   * KNN Proximity search using vectorized spherical projection
   * @param {Array} origin - [lat, lng] of reference point
   * @param {Array} targets - Array of target objects containing .koordinatlar [lat, lng]
   * @param {number} k - Number of nearest neighbors to retrieve
   */
  const findNearestKNN = (origin, targets, k = 3) => {
    if (!targets || targets.length === 0) return [];
    
    // 1. Project origin to 3D Cartesian vector
    const u = toCartesianVector(origin[0], origin[1]);
    
    // 2. Build target matrix (each row is [x, y, z])
    const F = targets.map(t => toCartesianVector(t.koordinatlar[0], t.koordinatlar[1]));
    
    // 3. Compute cosine similarity vector: s = F * u
    const similarities = multiplyMatrixVector(F, u);
    
    // 4. Map back to targets with distances (Haversine approximation from cosine similarity)
    // Distance = R * arccos(similarity) where R = 6371000 meters
    const mapped = targets.map((target, idx) => {
      const sim = Math.min(1.0, Math.max(-1.0, similarities[idx])); // Clamp to avoid NaN in acos
      const distance = 6371000 * Math.acos(sim);
      return { target, distance };
    });
    
    // 5. Sort ascending by distance and take top K
    return mapped.sort((a, b) => a.distance - b.distance).slice(0, k);
  };

  /**
   * TOPSIS (Technique for Order of Preference by Similarity to Ideal Solution)
   * Evaluates district urgency rankings using criteria weights.
   * 
   * Criteria Matrix X: rows are districts, columns are indicators:
   * Col 0: Population Density (Benefit - Higher is more urgent)
   * Col 1: Facility Count (Cost - Lower is more urgent)
   * Col 2: Average distance to nearest facility (Benefit - Higher is more urgent)
   * 
   * @param {Array} districts - Array of district features
   * @param {Array} facilities - Array of facilities
   * @param {Array} weights - Criteria weights [w0, w1, w2], must sum to 1.0
   */
  const rankDistrictsTOPSIS = (districts, facilities, weights = [0.4, 0.4, 0.2]) => {
    if (!districts || districts.length === 0) return [];

    // Calculate centroid distance approximation using average coordinates
    const getCentroid = (coords) => {
      let sumLat = 0, sumLng = 0, count = 0;
      const traverse = (arr) => {
        if (typeof arr[0] === 'number') {
          sumLng += arr[0];
          sumLat += arr[1];
          count++;
        } else {
          arr.forEach(traverse);
        }
      };
      traverse(coords);
      return [sumLat / count, sumLng / count];
    };

    // 1. Build Decision Matrix X (M districts x 3 criteria)
    const X = [];
    const districtData = districts.map(district => {
      const centroid = getCentroid(district.geometry.coordinates);
      const name = district.properties.name;
      const pop = district.properties.population || 100000; // Fallback
      
      // Approximate surface area using basic bounding box sizing (for density calculations)
      const facilityCount = district.properties.facilityCount || 0;
      
      // Calculate average distance to all facilities using KNN vector engine
      let avgDist = 5000; // default 5km
      if (facilities.length > 0) {
        const nearest = findNearestKNN(centroid, facilities, 3);
        avgDist = nearest.reduce((sum, n) => sum + n.distance, 0) / nearest.length;
      }

      // Calculate population density proxy (population / area-multiplier)
      // For simplicity, we use the facility count deficit and population size directly as TOPSIS inputs
      const density = pop / 100000; 

      X.push([density, facilityCount, avgDist]);

      return {
        name,
        population: pop,
        facilityCount,
        centroid
      };
    });

    const numRows = X.length;
    const numCols = 3;

    // 2. Vectorized Normalization: r_ij = x_ij / sqrt(sum(x_kj^2))
    const colNorms = new Float64Array(numCols);
    for (let j = 0; j < numCols; j++) {
      let sumSq = 0;
      for (let i = 0; i < numRows; i++) {
        sumSq += X[i][j] * X[i][j];
      }
      colNorms[j] = Math.sqrt(sumSq) || 1.0;
    }

    const V = X.map(row => {
      return row.map((val, j) => (val / colNorms[j]) * weights[j]);
    });

    // 3. Determine Ideal Best (A*) and Ideal Worst (A-)
    // Criteria directions: Density (0) is Benefit(max), Count (1) is Cost(min), AvgDistance (2) is Benefit(max)
    const idealBest = new Float64Array(numCols);
    const idealWorst = new Float64Array(numCols);

    for (let j = 0; j < numCols; j++) {
      let values = V.map(r => r[j]);
      if (j === 1) { // Cost column (count)
        idealBest[j] = Math.min(...values);
        idealWorst[j] = Math.max(...values);
      } else { // Benefit columns (density, avg distance)
        idealBest[j] = Math.max(...values);
        idealWorst[j] = Math.min(...values);
      }
    }

    // 4. Calculate Distance to Ideal Best (S*) and Ideal Worst (S-)
    const rankings = districtData.map((data, i) => {
      let sumSqBest = 0;
      let sumSqWorst = 0;
      for (let j = 0; j < numCols; j++) {
        const diffBest = V[i][j] - idealBest[j];
        const diffWorst = V[i][j] - idealWorst[j];
        sumSqBest += diffBest * diffBest;
        sumSqWorst += diffWorst * diffWorst;
      }
      const sBest = Math.sqrt(sumSqBest);
      const sWorst = Math.sqrt(sumSqWorst);
      
      // Closeness coefficient: C_i = S- / (S* + S-)
      const score = (sBest + sWorst) > 0 ? sWorst / (sBest + sWorst) : 0;

      return {
        ...data,
        score: score,
        urgency: score > 0.6 ? 'Kritik (Kırmızı Alarm)' : score > 0.45 ? 'Orta (Sarı Alarm)' : 'Yeterli (Yeşil Alarm)'
      };
    });

    // 5. Sort by closeness coefficient descending
    return rankings.sort((a, b) => b.score - a.score);
  };

  return {
    toCartesianVector,
    findNearestKNN,
    rankDistrictsTOPSIS
  };
})();

// Export for Node environment if needed, otherwise binds globally to browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MatrixEngine;
}
