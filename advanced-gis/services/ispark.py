import time
import math

# Baseline otopark capacity simulator
def get_ispark_occupancy(capacity):
    hour = time.localtime().tm_hour
    # Sine wave peaking at noon (12:00) and evening (19:00)
    factor = math.sin((hour - 8) * math.PI / 6) * 20
    percent = min(99, max(5, round(65 + factor)))
    free_spots = math.floor(capacity * (1 - percent / 100))
    return {
        "capacity": capacity,
        "percent_full": percent,
        "free_spots": free_spots
    }
