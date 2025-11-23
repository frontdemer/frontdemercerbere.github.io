import os
import json

# Paths
images_dir = "images"
output_json = "images.json"

# Build gallery structure
gallery = {}
for category in sorted(os.listdir(images_dir)):
    category_path = os.path.join(images_dir, category)
    if os.path.isdir(category_path):
        images = [os.path.join(category, f) for f in sorted(os.listdir(category_path))
                  if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.gif'))]
        if images:
            gallery[category] = images

# Write JSON
with open(output_json, "w", encoding="utf-8") as f:
    json.dump(gallery, f, indent=2, ensure_ascii=False)

print(f"Generated {output_json} with categories: {', '.join(gallery.keys())}")