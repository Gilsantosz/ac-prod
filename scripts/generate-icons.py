import os
from PIL import Image

def generate_icons():
    logo_path = 'public/brand/leo-madeiras-logo.jpg'
    output_dir = 'public/icons'
    
    if not os.path.exists(logo_path):
        print(f"Error: Logo file not found at {logo_path}")
        return
        
    os.makedirs(output_dir, exist_ok=True)
    
    with Image.open(logo_path) as img:
        print(f"Loaded logo {logo_path} of format {img.format} and size {img.size}")
        
        # Crop to square
        w, h = img.size
        min_dim = min(w, h)
        left = (w - min_dim) // 2
        top = (h - min_dim) // 2
        right = left + min_dim
        bottom = top + min_dim
        
        cropped = img.crop((left, top, right, bottom))
        
        # Save sizes
        sizes = [192, 512]
        for size in sizes:
            # Using Image.Resampling.LANCZOS for high quality resizing
            resized = cropped.resize((size, size), Image.Resampling.LANCZOS)
            
            # Paths to write
            standard_path = os.path.join(output_dir, f"icon-{size}.png")
            busted_path = os.path.join(output_dir, f"icon-{size}-v2.png")
            
            resized.save(standard_path, format="PNG")
            print(f"Saved {standard_path}")
            
            resized.save(busted_path, format="PNG")
            print(f"Saved {busted_path}")

if __name__ == '__main__':
    generate_icons()
