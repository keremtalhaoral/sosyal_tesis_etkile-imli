import urllib.request
import json
import math
import os

def generate_realistic_mock_weather(lat, lng):
    seed = math.sin(float(lat)) * math.cos(float(lng))
    temp_offset = round(seed * 4)
    base_temp = 25
    temp = base_temp + temp_offset
    
    index = abs(int(seed * 10)) % 4
    conditions = [
        "Açık / Güneşli",
        "Hafif Rüzgarlı / Güneşli",
        "Parçalı Bulutlu",
        "Az Bulutlu"
    ]
    condition = conditions[index]
    
    humidity = abs(int(seed * 25)) + 55
    wind = round(abs(seed * 12) + 6, 1)
    
    return {
        "temp": temp,
        "condition": condition,
        "humidity": humidity,
        "wind": wind,
        "isMock": True
    }

def get_live_weather(lat, lng):
    api_key = os.environ.get('OPENWEATHER_API_KEY')
    if not api_key:
        return generate_realistic_mock_weather(lat, lng)
        
    url = f"http://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lng}&units=metric&appid={api_key}"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=3) as response:
            if response.status == 200:
                data = json.loads(response.read().decode('utf-8'))
                
                # Weather translations map
                translations = {
                    "Clear": "Açık / Güneşli",
                    "Clouds": "Bulutlu",
                    "Rain": "Yağmurlu",
                    "Drizzle": "Çiseleyen Yağmur",
                    "Thunderstorm": "Fırtınalı Yağmur",
                    "Snow": "Karlı",
                    "Mist": "Sisli",
                    "Smoke": "Dumanlı",
                    "Haze": "Puslu",
                    "Dust": "Tozlu",
                    "Fog": "Sisli"
                }
                main_cond = data["weather"][0]["main"]
                turkish_cond = translations.get(main_cond, main_cond)
                
                return {
                    "temp": round(float(data["main"]["temp"]), 1),
                    "condition": turkish_cond,
                    "humidity": data["main"]["humidity"],
                    "wind": round(float(data["wind"]["speed"]) * 3.6, 1),
                    "isMock": False
                }
    except Exception:
        pass
        
    return generate_realistic_mock_weather(lat, lng)
