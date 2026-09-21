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
