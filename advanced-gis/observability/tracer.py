import time

# Observability usage statistics cache
api_call_counts = {
    "facilities_list": 0,
    "menu_scrape": 0,
    "weather_check": 0,
    "reservations": 0,
    "admin_actions": 0
}

def log_request(method, path, status, ip="127.0.0.1"):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
    
    # Increment usage metrics based on accessed path
    if "/api/facilities" in path:
        if method == "GET":
            api_call_counts["facilities_list"] += 1
        else:
            api_call_counts["admin_actions"] += 1
    elif "/api/menu" in path:
        api_call_counts["menu_scrape"] += 1
    elif "/api/weather" in path:
        api_call_counts["weather_check"] += 1
    elif "/api/reserve" in path or "/api/reservations" in path:
        api_call_counts["reservations"] += 1
        
    print(f"[{timestamp}] {ip} - {method} {path} - Status: {status}")

def get_cost_estimate() -> dict:
    # Simulated cloud provider API billing trace (e.g. OpenWeather + OSRM calls)
    weather_cost = api_call_counts["weather_check"] * 0.0015  # $0.0015 per call
    scraper_cost = api_call_counts["menu_scrape"] * 0.0005    # $0.0005 per parse
    total_cost = weather_cost + scraper_cost
    
    return {
        "call_counts": api_call_counts,
        "cost_estimates_usd": {
            "weather": round(weather_cost, 4),
            "menu_scraper": round(scraper_cost, 4),
            "total": round(total_cost, 4)
        }
    }
