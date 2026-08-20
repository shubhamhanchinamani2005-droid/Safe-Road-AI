import os

# Construct bytes for a mock JPEG file that passes the frontend's EXIF GPS check
data = bytearray()
data.extend([0xFF, 0xD8]) # SOI Marker
data.extend([0xFF, 0xE1]) # APP1 Marker
data.extend([0x00, 0x20]) # Length of APP1 (32 bytes)
data.extend([0x45, 0x78, 0x69, 0x66]) # 'Exif'
data.extend([0x00, 0x00]) # padding
data.extend([0x49, 0x49]) # TIFF header Intel byte order
data.extend([0x00, 0x2A]) # TIFF magic
data.extend([0x00, 0x00])
data.extend([0x88, 0x25]) # GPS IFD tag (0x8825)
# Fill remaining bytes to make a valid small file
data.extend([0x00] * 50)

# Write to file
target_path = os.path.join(os.path.dirname(__file__), "gps_test.jpg")
with open(target_path, "wb") as f:
    f.write(data)
print(f"Generated mock JPEG at: {target_path}")
