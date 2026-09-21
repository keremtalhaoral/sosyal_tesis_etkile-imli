import unittest
import math
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(BASE_DIR)

from services.weather import generate_realistic_mock_weather

class TestSpatialMath(unittest.TestCase):
    
    def test_mock_weather_generation(self):
        # Validate that weather is deterministic for the same lat/lng coordinates
        w1 = generate_realistic_mock_weather(41.0082, 28.9784)
        w2 = generate_realistic_mock_weather(41.0082, 28.9784)
        self.assertEqual(w1["temp"], w2["temp"])
        self.assertEqual(w1["condition"], w2["condition"])
        self.assertTrue(w1["isMock"])

    def test_distance_approximation(self):
        # Basic geodetic distance approximation check (Istanbul to Ankara coordinates)
        lat1, lng1 = 41.0082, 28.9784 # Istanbul
        lat2, lng2 = 39.9334, 32.8597 # Ankara
        
        # Geodetic distance formula
        rad_lat1, rad_lng1 = math.radians(lat1), math.radians(lng1)
        rad_lat2, rad_lng2 = math.radians(lat2), math.radians(lng2)
        
        dlon = rad_lng2 - rad_lng1
        dlat = rad_lat2 - rad_lat1
        a = math.sin(dlat/2)**2 + math.cos(rad_lat1) * math.cos(rad_lat2) * math.sin(dlon/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        distance = 6371 * c # in km
        
        # Verify distance is within expected threshold (~350km to ~450km range)
        self.assertTrue(300 < distance < 500)

if __name__ == '__main__':
    unittest.main()
