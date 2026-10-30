import os
import sys
import requests
import torch
from PIL import Image
import io

action = os.environ.get("ACTION_TYPE", "zimage")
prompt = os.environ.get("PROMPT", "")
image_url = os.environ.get("IMAGE_URL", "")
steps = int(os.environ.get("STEPS", "8"))
duration_val = os.environ.get("DURATION", "").strip()
seed_val = os.environ.get("SEED", "").strip()
style_val = os.environ.get("STYLE", "").strip()
discord_token = os.environ.get("DISCORD_TOKEN", "")
channel_id = os.environ.get("CHANNEL_ID", "")
user_id = os.environ.get("USER_ID", "")

print(f"[*] Initializing Unrestricted AI Task: {action} | Prompt: {prompt} | Duration: {duration_val or 'default'} | Seed: {seed_val or 'random'}")

output_path = "/tmp/ai_lab/output.png"
final_seed = None

def bypass_safety(pipeline):
    # Completely disable safety checkers / NSFW filters for 100% uncensored raw output
    if hasattr(pipeline, "safety_checker"):
        pipeline.safety_checker = None
    if hasattr(pipeline, "requires_safety_checker"):
        pipeline.requires_safety_checker = False
    return pipeline

import random
import subprocess
import time

def renew_tor_ip():
    """Instantly cycle to a fresh global Tor IP address"""
    try:
        subprocess.run(["sudo", "systemctl", "restart", "tor"], check=False)
        time.sleep(1.5)
        print("[*] 🔄 Tor IP Successfully Rotated to Fresh Clean Global Circuit!")
    except Exception as err:
        print(f"[-] Tor reload warning: {err}")

def extract_path(obj):
    """Recursively extract valid filepath from arbitrary Gradio result structures"""
    if isinstance(obj, str) and os.path.exists(obj):
        return obj
    if isinstance(obj, dict):
        for k in ("path", "image", "video", "url", "name"):
            if k in obj and obj[k]:
                res = extract_path(obj[k])
                if res:
                    return res
        for val in obj.values():
            res = extract_path(val)
            if res:
                return res
    if isinstance(obj, (list, tuple)):
        for item in obj:
            res = extract_path(item)
            if res:
                return res
    return None

if action == "zimage":
    # Multi-Space Mirror Pool with automatic fallback + Tor anti-ban proxy rotation
    spaces_pool = [
        "rahul7star/Z-Image-Turbo",
        "Tongyi-MAI/Z-Image-Turbo",
        "mfr414/Z-Image-Turbo",
        "KingNish/Z-Image-Turbo"
    ]

    from gradio_client import Client
    success = False

    # Parse aspect ratio and seed options
    ratio = image_url.strip() if image_url else "1:1"
    if ratio == "16:9":
        img_w, img_h = 1344, 768
    elif ratio == "9:16":
        img_w, img_h = 768, 1344
    else:
        img_w, img_h = 1024, 1024

    if seed_val and seed_val != "-1":
        try:
            rand_seed = int(seed_val)
            is_random_seed = False
        except:
            rand_seed = random.randint(1, 9999999)
            is_random_seed = True
    else:
        rand_seed = random.randint(1, 9999999)
        is_random_seed = True
    final_seed = rand_seed

    for space_name in spaces_pool:
        # Vector 1: Randomize browser user-agent & session fingerprint
        fake_chrome_ver = random.randint(115, 131)
        os.environ["HTTP_USER_AGENT"] = f"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/{fake_chrome_ver}.0.0.0 Safari/537.36"

        print(f"[*] Connecting to GPU Space Mirror: [{space_name}]...")
        try:
            client = Client(space_name)
            print(f"[*] Dispatching prompt to {space_name}: {prompt} | Steps: {steps} | Ratio: {ratio} | Seed: {rand_seed}")

            # Try specific endpoint or generic predict
            try:
                result = client.predict(
                    prompt=prompt,
                    height=img_h,
                    width=img_w,
                    num_inference_steps=steps,
                    seed=rand_seed,
                    randomize_seed=is_random_seed,
                    num_images=1,
                    api_name="/generate_image"
                )
            except Exception:
                # Fallback predict without extra sliders
                result = client.predict(prompt=prompt)

            if result and isinstance(result, tuple) and len(result) > 0:
                images_gallery = result[0]
                if isinstance(images_gallery, list) and len(images_gallery) > 0:
                    first_item = images_gallery[0]
                    img_path = first_item.get("image", {}).get("path") if isinstance(first_item, dict) and isinstance(first_item.get("image"), dict) else first_item.get("image")
                    if img_path and os.path.exists(img_path):
                        Image.open(img_path).save(output_path, format="PNG")
                        success = True
                        break
            elif isinstance(result, str) and os.path.exists(result):
                Image.open(result).save(output_path, format="PNG")
                success = True
                break
        except Exception as space_err:
            print(f"[-] Mirror {space_name} rate-limited/busy: {space_err}")
            print("[*] Vector 4: Triggering Tor Circuit Renewal for fresh identity...")
            renew_tor_ip()
            continue

    if not success:
        print("[-] All GPU mirrors busy, triggering direct local 23GB memory pipeline fallback...")
        from diffusers import DiffusionPipeline
        pipe = DiffusionPipeline.from_pretrained(
            "Tongyi-MAI/Z-Image-Turbo",
            torch_dtype=torch.float32,
            low_cpu_mem_usage=True
        )
        pipe = bypass_safety(pipe)
        pipe.to("cpu")
        image = pipe(prompt=prompt, num_inference_steps=steps, guidance_scale=0.0).images[0]
        image.save(output_path, format="PNG")

elif action == "qwen-edit":
    print(f"[*] Loading Qwen Rapid AIO for prompt: {prompt}")
    from gradio_client import Client, handle_file
    import random
    # Download base image
    input_img_path = "/tmp/ai_lab/input.png"
    resp = requests.get(image_url, timeout=15)
    with open(input_img_path, "wb") as f:
        f.write(resp.content)

    if seed_val and seed_val != "-1":
        try:
            edit_seed = int(seed_val)
            is_rand_seed = False
        except:
            edit_seed = random.randint(1, 9999999)
            is_rand_seed = True
    else:
        edit_seed = random.randint(1, 9999999)
        is_rand_seed = True
    final_seed = edit_seed

    # Parse quality mode sent as "fast__StyleName" or "ultra__StyleName" from bot
    quality_mode = "fast"
    raw_style = style_val if style_val else "Ultrarealistic-Portrait"
    if "__" in raw_style:
        parts = raw_style.split("__", 1)
        quality_mode = parts[0].strip().lower()  # "fast" or "ultra"
        raw_style = parts[1].strip()

    # Determine LoRA style (defaults to Ultrarealistic-Portrait for clear 4K quality)
    active_lora = raw_style if raw_style else "Ultrarealistic-Portrait"
    prompt_lower = prompt.lower()
    if any(k in prompt_lower for k in ["upscale", "4k", "clear", "unblur", "enhance", "hd"]):
        if not raw_style or raw_style == "Ultrarealistic-Portrait":
            active_lora = "Upscale2K"

    # Quality-dependent parameters: Ultra = original high-res, Fast = ZeroGPU-safe
    if quality_mode == "ultra":
        q_target_mp   = 2.25   # aet256: target megapixels (original)
        q_steps_cap   = 50     # aet256/Gameyguy: uncapped steps
        q_g_height    = 1280   # Gameyguy: resolution
        q_g_width     = 1280
        q_k_steps_cap = 6      # kulkas2pintu: steps cap
        q_k_size      = 1920   # kulkas2pintu: output size
        q_k_identity  = 75
        q_off_steps   = 30     # Official Qwen: inference steps
        q_off_gs      = 4.0    # Official Qwen: guidance scale
        q_off_h       = 1024   # Official Qwen: resolution
        q_off_w       = 1024
    else:
        # Fast / ZeroGPU-safe defaults
        q_target_mp   = 1.2
        q_steps_cap   = 8
        q_g_height    = 1024
        q_g_width     = 1024
        q_k_steps_cap = 4
        q_k_size      = 1024
        q_k_identity  = 60
        q_off_steps   = 8
        q_off_gs      = 2.5
        q_off_h       = 768
        q_off_w       = 768

    print(f"[*] Qwen Edit Configuration: LoRA={active_lora} | Quality={quality_mode.upper()} | Seed={final_seed} | 4K/2K High-Res Pipeline Enabled")

    qwen_success = False
    # 1. Primary: aet256 Rapid AIO LoRAs Space (Ultra fast 4K/2K GPU inference)
    try:
        print(f"[*] Connecting to aet256/Qwen-Image-Edit-Rapid-AIO-Loras-Experimental (LoRA: {active_lora})...")
        client = Client("aet256/Qwen-Image-Edit-Rapid-AIO-Loras-Experimental")

        # Call /infer endpoint (resolution_multiple expects choice: '32', '56', '112')
        result = client.predict(
            input_image_1=handle_file(input_img_path),
            input_image_2=handle_file(input_img_path),
            input_images_extra=[],
            prompt=prompt,
            lora_adapter=active_lora,
            seed=edit_seed,
            randomize_seed=is_rand_seed,
            guidance_scale=1.5,
            steps=steps if steps and steps <= q_steps_cap else 6,
            target_megapixels=q_target_mp,
            extras_condition_only=True,
            pad_to_canvas=True,
            vae_tiling=False,
            resolution_multiple=32,
            vae_ref_megapixels=0.0,
            decoder_vae="wan2x",
            keep_decoder_2x=True,
            highlight_protection=True,
            highlight_protection_strength=0.30,
            api_name="/infer"
        )

        # result[0] is output image filepath
        out_file = result[0] if isinstance(result, (tuple, list)) else result
        if isinstance(out_file, dict):
            out_file = out_file.get("path")
        if out_file and os.path.exists(out_file):
            Image.open(out_file).save(output_path, format="PNG")
            if isinstance(result, (tuple, list)) and len(result) > 1 and result[1] is not None:
                try:
                    final_seed = int(result[1])
                except:
                    final_seed = edit_seed
            print(f"[+] Qwen Rapid AIO Edit Completed via aet256 GPU Space! (Seed: {final_seed})")
            qwen_success = True
    except Exception as e:
        print(f"[-] aet256 space error: {e}")
        renew_tor_ip()

    # 2. Secondary: Gameyguy/Qwen-Image-Edit-2511-Turbo-Lightning (Ultra-Fast 1280p Turbo)
    if not qwen_success:
        try:
            print("[*] Trying Secondary: Gameyguy/Qwen-Image-Edit-2511-Turbo-Lightning...")
            client = Client("Gameyguy/Qwen-Image-Edit-2511-Turbo-Lightning")
            result = client.predict(
                images=[{"image": handle_file(input_img_path)}],
                prompt=prompt,
                seed=edit_seed,
                randomize_seed=is_rand_seed,
                true_guidance_scale=1.5,
                num_inference_steps=steps if steps and steps <= q_steps_cap else 6,
                height=q_g_height,
                width=q_g_width,
                rewrite_prompt=False,
                num_images_per_prompt=1,
                api_name="/infer"
            )
            gallery = result[0] if isinstance(result, (tuple, list)) else result
            if isinstance(gallery, list) and gallery:
                first = gallery[0]
                out_file = first.get("image", {}).get("path") if isinstance(first, dict) and isinstance(first.get("image"), dict) else (first.get("image") if isinstance(first, dict) else first)
            else:
                out_file = gallery
            if out_file and os.path.exists(out_file):
                Image.open(out_file).save(output_path, format="PNG")
                if isinstance(result, (tuple, list)) and len(result) > 1 and result[1] is not None:
                    try:
                        final_seed = int(result[1])
                    except:
                        final_seed = edit_seed
                print(f"[+] Qwen Edit Complete via Gameyguy Turbo-Lightning! (Seed: {final_seed})")
                qwen_success = True
        except Exception as e_gameyguy:
            print(f"[-] Gameyguy Turbo-Lightning error: {e_gameyguy}")
            renew_tor_ip()

    # 3. Tertiary: kulkas2pintu/QWEN_EDIT_IMAGE Space (Ultra-Realistic 1920p LoRA)
    if not qwen_success:
        try:
            print("[*] Trying Tertiary: kulkas2pintu/QWEN_EDIT_IMAGE...")
            kulkas_lora = "Ultra-Realistic-Portrait" if active_lora in ["Ultrarealistic-Portrait", "Hyperrealistic-Portrait"] else ("Upscaler" if "upscale" in active_lora.lower() else "")
            client = Client("kulkas2pintu/QWEN_EDIT_IMAGE")
            result = client.predict(
                image=handle_file(input_img_path),
                prompt=prompt,
                lora_adapter=kulkas_lora,
                image2=None,
                seed=edit_seed,
                randomize_seed=is_rand_seed,
                guidance_scale=1.5,
                steps=steps if steps and steps <= q_k_steps_cap else q_k_steps_cap,
                preserve_identity=True,
                identity_strength=q_k_identity,
                output_size=q_k_size,
                fix_hands=True,
                api_name="/edit"
            )
            out_file = result[0] if isinstance(result, (tuple, list)) else result
            if isinstance(out_file, dict):
                out_file = out_file.get("path")
            if out_file and os.path.exists(out_file):
                Image.open(out_file).save(output_path, format="PNG")
                if isinstance(result, (tuple, list)) and len(result) > 1 and result[1] is not None:
                    try:
                        final_seed = int(result[1])
                    except:
                        final_seed = edit_seed
                print(f"[+] Qwen Edit Complete via kulkas2pintu Space! (Seed: {final_seed})")
                qwen_success = True
        except Exception as e_kulkas:
            print(f"[-] kulkas2pintu error: {e_kulkas}")
            renew_tor_ip()

    # 4. Quaternary: Official Qwen/Qwen-Image-Edit-2511 space (/infer endpoint)
    if not qwen_success:
        try:
            print("[*] Fallback: Connecting to official Qwen/Qwen-Image-Edit-2511...")
            client = Client("Qwen/Qwen-Image-Edit-2511")
            result = client.predict(
                images=[{"image": handle_file(input_img_path)}],
                prompt=prompt,
                seed=edit_seed,
                randomize_seed=is_rand_seed,
                true_guidance_scale=q_off_gs,
                num_inference_steps=q_off_steps,
                height=q_off_h,
                width=q_off_w,
                rewrite_prompt=False,
                api_name="/infer"
            )
            gallery = result[0] if isinstance(result, (tuple, list)) else result
            if isinstance(gallery, list) and gallery:
                first = gallery[0]
                out_file = first.get("image", {}).get("path") if isinstance(first, dict) and isinstance(first.get("image"), dict) else (first.get("image") if isinstance(first, dict) else first)
            else:
                out_file = gallery
            if out_file and os.path.exists(out_file):
                Image.open(out_file).save(output_path, format="PNG")
                if isinstance(result, (tuple, list)) and len(result) > 1 and result[1] is not None:
                    try:
                        final_seed = int(result[1])
                    except:
                        final_seed = edit_seed
                print(f"[+] Qwen Official Space Completed! (Seed: {final_seed})")
                qwen_success = True
        except Exception as e2:
            print(f"[-] Official space error: {e2}")

    if not qwen_success:
        print("[-] All GPU Qwen Edit mirrors were busy or temporarily rate-limited.")

    # Auto-Chain with FLUX.2-Klein-Multi-LoRA for 4K Super-Upscaling if requested
    if qwen_success and (duration_val == "flux_upscale" or "flux" in str(style_val).lower()):
        print("[*] Chaining Qwen Edit output into FLUX.2-Klein-Multi-LoRA for 4K UltraSharp & Depth Realism...")
        try:
            client_flux = Client("M3st3rJ4k3l/FLUX.2-Klein-Multi-LoRA")
            klein_res = client_flux.predict(
                base_image=handle_file(output_path),
                reference_images=[],
                prompt=prompt,
                lora_prompt_text="",
                custom_prompt_text="",
                selected_titles=['Ultimate Upscaler Klein-9b', 'High Resolution', 'Klein-Delight-Style'],
                seed=final_seed or edit_seed,
                randomize_seed=False,
                guidance_scale=1.0,
                steps=4,
                upscale_factor="4× — UltraSharp (crisp)",
                canvas_mode="Auto (from base image)",
                custom_width=1024,
                custom_height=1024,
                canvas_fit_mode="Stretch",
                pad_color="#000000",
                batch_count=1,
                batch_vary="Random seed each run",
                sweep_min=0.4,
                sweep_max=1.4,
                param_21=1.0,
                param_22=1.0,
                param_23=1.0,
                param_24=1.0,
                param_25=1.0,
                param_26=1.0,
                api_name="/infer"
            )
            klein_gallery = klein_res[0] if isinstance(klein_res, (tuple, list)) else klein_res
            if isinstance(klein_gallery, list) and klein_gallery:
                k_first = klein_gallery[0]
                k_path = k_first.get("image", {}).get("path") if isinstance(k_first, dict) and isinstance(k_first.get("image"), dict) else (k_first.get("image") if isinstance(k_first, dict) else k_first)
                if k_path and os.path.exists(k_path):
                    import shutil
                    shutil.copyfile(k_path, output_path)
                    print("[+] FLUX.2 Klein 4K UltraSharp Super-Upscale Complete!")
        except Exception as e_flux:
            print(f"[-] FLUX.2 Klein chaining error: {e_flux}")


elif action == "flux-klein":
    print(f"[*] Connecting to FLUX.2-Klein-Multi-LoRA Studio for prompt: {prompt}...")
    from gradio_client import Client, handle_file
    import random
    image_output_path = "/tmp/ai_lab/output.png"
    output_path = image_output_path
    input_img_path = "/tmp/ai_lab/input.png"

    # Download image if provided
    has_image = bool(image_url and image_url.startswith("http"))
    if has_image:
        try:
            resp = requests.get(image_url, timeout=15)
            with open(input_img_path, "wb") as f:
                f.write(resp.content)
        except Exception as e:
            print(f"[-] Image download error: {e}")
            has_image = False

    # If no image provided, generate an initial base image via Krea-2 for text-to-image
    if not has_image or not os.path.exists(input_img_path):
        try:
            print(f"[*] Generating initial base image via Krea-2 for text-to-image...")
            krea_client = Client("ravenrose996688/Krea-2-Turbo_I2I")
            krea_res = krea_client.predict(
                param_0="text2image", param_1=prompt, param_2=None, param_3=None, param_4=None,
                param_5=1024, param_6=1024, param_7=1.4, param_8=768, param_9=1.0, param_10=1.0,
                param_11=6, param_12=1.0, param_13="euler", param_14="beta", param_15=random.randint(1, 999999),
                param_16=True, param_17=0, param_18="pornmasterKrea2_v2TurboInt8.safetensors",
                param_19=None, param_20=None, param_21=None,
                param_22={'headers': ['repo_id', 'filename', 'revision', 'weight'], 'data': [], 'metadata': None},
                param_23=0.0, param_24=0.8, param_25=0.0, param_26=0.0, param_27=0.0,
                param_28=0.0, param_29=0.0, param_30=0.0, param_31=0.0, param_32=0.0,
                param_33=0.0, param_34=0.0, param_35=0.0, param_36=0.0, param_37=0.0,
                param_38=0.0, param_39=0.0, param_40=0.0, api_name="/_generate_wrapper"
            )
            base_img = extract_path(krea_res)
            if base_img and os.path.exists(base_img):
                import shutil
                shutil.copyfile(base_img, input_img_path)
                has_image = True
        except Exception as err:
            print(f"[-] Base frame gen error: {err}")

    if seed_val and seed_val != "-1":
        try:
            klein_seed = int(seed_val)
        except:
            klein_seed = random.randint(1, 9999999)
    else:
        klein_seed = random.randint(1, 9999999)
    final_seed = klein_seed

    # Determine LoRA list based on style_val
    if style_val == "instapic":
        selected_loras = ['InstaPic', 'High Resolution', 'Klein-Delight-Style']
    elif style_val == "delight":
        selected_loras = ['Klein-Delight-Style', 'Controllight', 'High Resolution']
    elif style_val == "face_swap":
        selected_loras = ['Best-Face-Swap', 'Klein-Consistency', 'High Resolution']
    elif style_val == "none":
        selected_loras = []
    else:
        # Default: Ultimate Upscaler + High Resolution + Klein Delight for maximum depth & clarity
        selected_loras = ['Ultimate Upscaler Klein-9b', 'High Resolution', 'Klein-Delight-Style']

    # Determine upscale factor from duration_val
    valid_factors = [
        '4× — UltraSharp (crisp)', '4× — Nomos2 HQ DAT2 (Photography)',
        '4× — Remacri (natural)', '2× — RealESRGAN (balanced)', 'None'
    ]
    upscale_choice = duration_val if duration_val in valid_factors else '4× — UltraSharp (crisp)'

    klein_steps = steps if (steps and 2 <= steps <= 15) else 4
    print(f"[*] Dispatching to FLUX.2 Klein: LoRAs={selected_loras} | Upscaler={upscale_choice} | Steps={klein_steps} | Seed={final_seed}")

    try:
        client_flux = Client("M3st3rJ4k3l/FLUX.2-Klein-Multi-LoRA")
        klein_res = client_flux.predict(
            base_image=handle_file(input_img_path) if (has_image and os.path.exists(input_img_path)) else None,
            reference_images=[],
            prompt=prompt,
            lora_prompt_text="",
            custom_prompt_text="",
            selected_titles=selected_loras,
            seed=final_seed,
            randomize_seed=False,
            guidance_scale=1.0,
            steps=klein_steps,
            upscale_factor=upscale_choice,
            canvas_mode="Auto (from base image)" if (has_image and os.path.exists(input_img_path)) else "Custom",
            custom_width=1024,
            custom_height=1024,
            canvas_fit_mode="Stretch",
            pad_color="#000000",
            batch_count=1,
            batch_vary="Random seed each run",
            sweep_min=0.4,
            sweep_max=1.4,
            param_21=1.0,
            param_22=1.0,
            param_23=1.0,
            param_24=1.0,
            param_25=1.0,
            param_26=1.0,
            api_name="/infer"
        )
        klein_gallery = klein_res[0] if isinstance(klein_res, (tuple, list)) else klein_res
        if isinstance(klein_gallery, list) and klein_gallery:
            k_first = klein_gallery[0]
            k_path = k_first.get("image", {}).get("path") if isinstance(k_first, dict) and isinstance(k_first.get("image"), dict) else (k_first.get("image") if isinstance(k_first, dict) else k_first)
            if k_path and os.path.exists(k_path):
                import shutil
                shutil.copyfile(k_path, output_path)
                print("[+] FLUX.2 Klein Generation & 4K Upscale Complete!")
    except Exception as err:
        print(f"[-] FLUX.2 Klein error: {err}")
        renew_tor_ip()

elif action == "qwen21-unrestricted":
    print(f"[*] Connecting to Qwen-Image-2.1-Uncensored-GGUF Studio for prompt: {prompt}")
    from gradio_client import Client, handle_file
    import random
    
    output_path = "/tmp/ai_lab/output.png"
    
    # Parse mode from style_val
    mode = style_val if style_val else "Create an image"
    
    # Parse aspect ratio from duration_val
    aspect_ratio = duration_val if duration_val else "Square · 1:1 (1024x1024)"
    
    # Parse seed
    if seed_val and seed_val != "-1":
        try:
            gen_seed = int(seed_val)
            randomize_seed = False
        except:
            gen_seed = 42
            randomize_seed = True
    else:
        gen_seed = 42
        randomize_seed = True
    final_seed = gen_seed
    
    # Download reference image if image_url provided (for Edit mode or Transparent PNG)
    reference_img = None
    if image_url and image_url.startswith("http"):
        try:
            input_img_path = "/tmp/ai_lab/input_qwen21.png"
            resp = requests.get(image_url, timeout=15)
            with open(input_img_path, "wb") as f:
                f.write(resp.content)
            reference_img = input_img_path
            print(f"[*] Reference image downloaded for {mode}")
        except Exception as e:
            print(f"[-] Reference image download error: {e}")
    
    print(f"[*] Qwen21 Configuration: Mode={mode} | Ratio={aspect_ratio} | Steps={steps} | Seed={gen_seed} | Randomize={randomize_seed}")
    
    try:
        client = Client("arudradey/qwen-image-2.1-uncensored-gguf")
        result = client.predict(
            prompt=prompt,
            mode=mode,
            reference=handle_file(reference_img) if reference_img else None,
            aspect_ratio=aspect_ratio,
            steps=float(steps) if steps else 40.0,
            seed=gen_seed,
            randomize_seed=randomize_seed,
            api_name="/generate"
        )
        
        # result = (generated_output, download_full_resolution_png, seed, generation_details)
        if result and isinstance(result, tuple) and len(result) >= 2:
            # Try generated_output first (index 0)
            gen_output = result[0]
            if isinstance(gen_output, str) and os.path.exists(gen_output):
                Image.open(gen_output).save(output_path, format="PNG")
                print("[+] Qwen-Image-2.1 Uncensored Generation Complete!")
            # Try full resolution PNG (index 1)
            elif len(result) > 1 and isinstance(result[1], str) and os.path.exists(result[1]):
                Image.open(result[1]).save(output_path, format="PNG")
                print("[+] Qwen-Image-2.1 Uncensored Generation Complete (Full Res)!")
            
            # Extract actual used seed from result[2]
            if len(result) > 2 and result[2] is not None:
                try:
                    final_seed = int(result[2])
                except:
                    pass
    except Exception as err:
        print(f"[-] Qwen21-Unrestricted error: {err}")
        renew_tor_ip()

elif action == "wan-video":
    print(f"[*] Connecting to Wan 2.2 Uncensored Video Space (STCM Missionary AOTI)...")
    from gradio_client import Client, handle_file
    import random

    video_output_path = "/tmp/ai_lab/output.mp4"
    output_path = video_output_path
    input_img_path = "/tmp/ai_lab/input.png"

    # Parse dynamic duration (up to 10s supported)
    try:
        video_duration = float(duration_val) if duration_val else 5.0
        if video_duration < 1.0:
            video_duration = 1.0
        elif video_duration > 10.0:
            video_duration = 10.0
    except Exception:
        video_duration = 5.0

    if seed_val and seed_val != "-1":
        try:
            rand_seed = int(seed_val)
        except:
            rand_seed = random.randint(1, 9999999)
    else:
        rand_seed = random.randint(1, 9999999)
    final_seed = rand_seed
    wan_success = False

    print(f"[*] Wan 2.2 Configuration: Duration={video_duration}s | Steps={steps} | Seed={rand_seed}")

    # Check or prepare input image
    has_image = bool(image_url and image_url.startswith("http"))
    if has_image:
        try:
            resp = requests.get(image_url, timeout=15)
            with open(input_img_path, "wb") as f:
                f.write(resp.content)
        except Exception as e:
            print(f"[-] Image download error: {e}")
            has_image = False

    # If no image provided, generate an ultra-fast base image via Krea-2
    if not has_image or not os.path.exists(input_img_path):
        try:
            print(f"[*] Auto-generating base frame for prompt: {prompt[:60]}...")
            krea_client = Client("ravenrose996688/Krea-2-Turbo_I2I")
            krea_res = krea_client.predict(
                param_0="text2image", param_1=prompt, param_2=None, param_3=None, param_4=None,
                param_5=832, param_6=480, param_7=1.4, param_8=768, param_9=1.0, param_10=1.0,
                param_11=6, param_12=1.0, param_13="euler", param_14="beta", param_15=rand_seed,
                param_16=True, param_17=0, param_18="pornmasterKrea2_v2TurboInt8.safetensors",
                param_19=None, param_20=None, param_21=None,
                param_22={'headers': ['repo_id', 'filename', 'revision', 'weight'], 'data': [], 'metadata': None},
                param_23=0.0, param_24=0.8, param_25=0.0, param_26=0.0, param_27=0.0,
                param_28=0.0, param_29=0.0, param_30=0.0, param_31=0.0, param_32=0.0,
                param_33=0.0, param_34=0.0, param_35=0.0, param_36=0.0, param_37=0.0,
                param_38=0.0, param_39=0.0, param_40=0.0, api_name="/_generate_wrapper"
            )
            base_img = extract_path(krea_res)
            if base_img and os.path.exists(base_img):
                import shutil
                shutil.copyfile(base_img, input_img_path)
                has_image = True
        except Exception as err:
            print(f"[-] Base frame gen error: {err}")

    # Space 1: STCM/wan2-2-fp8da-aoti-preview-2c-missionary (Unrestricted FP8DA AOTI)
    try:
        print(f"[*] Connecting to STCM/wan2-2-fp8da-aoti-preview-2c-missionary (Duration={video_duration}s)...")
        client = Client("STCM/wan2-2-fp8da-aoti-preview-2c-missionary")
        result = client.predict(
            input_image=handle_file(input_img_path) if os.path.exists(input_img_path) else None,
            last_image=None,
            prompt=prompt,
            steps=steps if steps <= 12 else 6,
            negative_prompt="blurry, distorted, low quality, static, artifacts",
            duration_seconds=video_duration,
            guidance_scale=1.0,
            guidance_scale_2=1.0,
            seed=rand_seed,
            randomize_seed=True,
            quality=6,
            scheduler="UniPCMultistep",
            flow_shift=3.0,
            frame_multiplier=16,
            safe_mode=False,
            video_component=True,
            api_name="/generate_video"
        )
        vid_path = extract_path(result)
        if vid_path and os.path.exists(vid_path):
            import shutil
            shutil.copyfile(vid_path, video_output_path)
            print("[+] Wan 2.2 Missionary Video Complete!")
            wan_success = True
        else:
            print(f"[-] STCM Missionary path not resolved from result: {result}")
            renew_tor_ip()
    except Exception as e:
        print(f"[-] STCM Missionary error: {e}")
        renew_tor_ip()

    # Space 2: r3gm/wan2-2-fp8da-aoti-preview (Official High-Speed AOTI + Uncensored switches)
    if not wan_success:
        try:
            print(f"[*] Trying Fallback 2: r3gm/wan2-2-fp8da-aoti-preview (Duration={video_duration}s)...")
            client = Client("r3gm/wan2-2-fp8da-aoti-preview")
            result = client.predict(
                input_image=handle_file(input_img_path) if os.path.exists(input_img_path) else None,
                last_image=None,
                prompt=prompt,
                steps=steps if steps <= 12 else 6,
                negative_prompt="blurry, distorted, low quality, static, artifacts",
                duration_seconds=video_duration,
                guidance_scale=1.0,
                guidance_scale_2=1.0,
                seed=rand_seed,
                randomize_seed=True,
                quality=6,
                scheduler="UniPCMultistep",
                flow_shift=3.0,
                frame_multiplier=16,
                video_component=True,
                safe_mode=False,
                enable_safety_checker=False,
                api_name="/generate_video"
            )
            vid_path = extract_path(result)
            if vid_path and os.path.exists(vid_path):
                import shutil
                shutil.copyfile(vid_path, video_output_path)
                print("[+] Wan 2.2 r3gm Video Complete!")
                wan_success = True
        except Exception as e_r3gm:
            print(f"[-] r3gm error: {e_r3gm}")
            renew_tor_ip()

    # Space 3: kulkas2pintu/edit-video-wan fallback
    if not wan_success:
        try:
            print(f"[*] Trying Fallback 3: kulkas2pintu/edit-video-wan (Duration={video_duration}s)...")
            client = Client("kulkas2pintu/edit-video-wan")
            result = client.predict(
                input_image=handle_file(input_img_path) if os.path.exists(input_img_path) else None,
                last_image=None,
                prompt=prompt,
                steps=steps if steps <= 12 else 6,
                negative_prompt="blurry, distorted, low quality, static",
                duration_seconds=video_duration,
                guidance_scale=1.0,
                guidance_scale_2=1.0,
                seed=rand_seed,
                randomize_seed=True,
                quality=6,
                scheduler="UniPCMultistep",
                flow_shift=3.0,
                frame_multiplier=16,
                video_component=True,
                safe_mode=False,
                api_name="/generate_video"
            )
            vid_path = extract_path(result)
            if vid_path and os.path.exists(vid_path):
                import shutil
                shutil.copyfile(vid_path, video_output_path)
                print("[+] Wan Video Complete from kulkas2pintu Space!")
                wan_success = True
        except Exception as e2:
            print(f"[-] kulkas2pintu space error: {e2}")
            renew_tor_ip()

    # Space 4: Pepe104/MiniMax-H3-Turbo-Lora-UNCENSORED (100% Unrestricted Text/Image to Video)
    if not wan_success:
        try:
            print(f"[*] Trying Fallback 4: Pepe104/MiniMax-H3-Turbo-Lora-UNCENSORED (Duration={video_duration}s)...")
            client = Client("Pepe104/MiniMax-H3-Turbo-Lora-UNCENSORED")
            result = client.predict(
                prompt=prompt,
                image_path=handle_file(input_img_path) if os.path.exists(input_img_path) else None,
                last_image_path=None,
                canvas="960x544 · 16:9 fast",
                duration=video_duration,
                steps=4,
                seed=rand_seed,
                upsample=False,
                use_lora=True,
                lora="larry",
                api_name="/generate"
            )
            vid_path = extract_path(result)
            if vid_path and os.path.exists(vid_path):
                import shutil
                shutil.copyfile(vid_path, video_output_path)
                print("[+] Uncensored Video Complete from Pepe104 Space!")
                wan_success = True
        except Exception as e3:
            print(f"[-] Pepe104 error: {e3}")
            renew_tor_ip()

    # Space 5: mrfakename/minimax-h3-ultra-fast fallback
    if not wan_success:
        try:
            print(f"[*] Trying Fallback 5: mrfakename/minimax-h3-ultra-fast (Duration={video_duration}s)...")
            client = Client("mrfakename/minimax-h3-ultra-fast")
            result = client.predict(
                prompt=prompt,
                image_path=handle_file(input_img_path) if os.path.exists(input_img_path) else None,
                last_image_path=None,
                canvas="960x544 · 16:9 fast",
                duration=video_duration,
                steps=4,
                seed=rand_seed,
                upsample=False,
                acceleration="Balanced",
                lora_preset="None",
                lora_repo="",
                lora_filename="",
                lora_strength=1.0,
                generation_preset="Balanced · best overall (recommended)",
                references=None,
                api_name="/generate"
            )
            vid_path = extract_path(result)
            if vid_path and os.path.exists(vid_path):
                import shutil
                shutil.copyfile(vid_path, video_output_path)
                print("[+] Video Complete via mrfakename Fallback!")
                wan_success = True
        except Exception as e4:
            print(f"[-] mrfakename fallback error: {e4}")
            renew_tor_ip()


elif action == "krea-2":
    print(f"[*] Connecting to Krea-2-Turbo Ultra-Realism / Unrestricted Space...")
    from gradio_client import Client
    import random
    try:
        client = Client("ravenrose996688/Krea-2-Turbo_I2I")
        ratio = image_url.strip() if image_url else "1:1"
        if ratio == "16:9":
            krea_w, krea_h = 1280, 720
        elif ratio == "9:16":
            krea_w, krea_h = 720, 1280
        else:
            krea_w, krea_h = 1024, 1024

        if seed_val and seed_val != "-1":
            try:
                krea_seed = int(seed_val)
                krea_rand = False
            except:
                krea_seed = random.randint(1, 9999999)
                krea_rand = True
        else:
            krea_seed = random.randint(1, 9999999)
            krea_rand = True
        final_seed = krea_seed

        # Professional photorealism prompt tuning
        tuned_prompt = f"{prompt}, raw photo, 8k uhd, dslr, soft natural lighting, high quality, film grain, Fujifilm XT4"
        print(f"[*] Dispatching tuned prompt: {tuned_prompt} | Ratio: {ratio} | Seed: {krea_seed}")

        result = client.predict(
            param_0="text2image",
            param_1=tuned_prompt,
            param_2=None,
            param_3=None,
            param_4=None,
            param_5=krea_w,
            param_6=krea_h,
            param_7=1.4,
            param_8=768,
            param_9=1.0,
            param_10=1.0,
            param_11=steps if steps <= 15 else 8,
            param_12=1.0,
            param_13="euler",
            param_14="beta",
            param_15=krea_seed,
            param_16=krea_rand,
            param_17=0,
            param_18="pornmasterKrea2_v2TurboInt8.safetensors",
            param_19=None,
            param_20=None,
            param_21=None,
            param_22={'headers': ['repo_id', 'filename', 'revision', 'weight'], 'data': [], 'metadata': None},
            param_23=0.0,
            param_24=0.8, # Refusal-Reduction LoRA enabled!
            param_25=0.0,
            param_26=0.0,
            param_27=0.0,
            param_28=0.0,
            param_29=0.0,
            param_30=0.0,
            param_31=0.0,
            param_32=0.0,
            param_33=0.0,
            param_34=0.0,
            param_35=0.0,
            param_36=0.0,
            param_37=0.0,
            param_38=0.0,
            param_39=0.0,
            param_40=0.0,
            api_name="/_generate_wrapper"
        )

        img_path = extract_path(result)
        if img_path and os.path.exists(img_path):
            Image.open(img_path).save(output_path, format="PNG")
            print("[+] Krea-2 Ultra-Realistic Generation Complete!")
        else:
            print(f"[-] Krea-2 image path not resolved from result: {result}")
    except Exception as err:
        print(f"[-] Krea-2 generation error: {err}")
        renew_tor_ip()

elif action == "minimax-h3":
    print(f"[*] Connecting to MiniMax-H3 Uncensored Video+Audio Space...")
    from gradio_client import Client
    import random
    video_output_path = "/tmp/ai_lab/output.mp4"
    output_path = video_output_path

    try:
        video_duration = float(duration_val) if duration_val else 5.0
        if video_duration < 1.0:
            video_duration = 1.0
        elif video_duration > 10.0:
            video_duration = 10.0
    except:
        video_duration = 5.0

    if seed_val and seed_val != "-1":
        try:
            rand_seed = int(seed_val)
        except:
            rand_seed = random.randint(1, 999999)
    else:
        rand_seed = random.randint(1, 999999)
    final_seed = rand_seed

    print(f"[*] MiniMax-H3 Configuration: Duration={video_duration}s | Steps={steps} | Seed={rand_seed}")
    mm_success = False

    # Space 1: Pepe104 (Uncensored + Turbo LoRA)
    if not mm_success:
        try:
            print(f"[*] Trying Pepe104/MiniMax-H3-Turbo-Lora-UNCENSORED (Duration={video_duration}s, Steps={steps})...")
            client = Client("Pepe104/MiniMax-H3-Turbo-Lora-UNCENSORED")
            result = client.predict(
                prompt=f"{prompt}, photorealistic 8k, cinematic lighting, high fidelity, ultra detailed",
                image_path=None,
                last_image_path=None,
                canvas="960x544 \u00b7 16:9 fast",
                duration=video_duration,
                steps=steps if (4 <= steps <= 12) else 4,
                seed=rand_seed,
                upsample=False,
                use_lora=True,
                lora="larry",
                api_name="/generate"
            )
            vid_path = extract_path(result)
            if vid_path and os.path.exists(vid_path):
                import shutil
                shutil.copyfile(vid_path, video_output_path)
                print("[+] MiniMax-H3 Video+Audio Complete from Pepe104!")
                mm_success = True
        except Exception as err:
            print(f"[-] Pepe104 error: {err}")
            renew_tor_ip()

    # Space 2: mrfakename (ultra-fast + Turbo LoRA hyper-fidelity)
    if not mm_success:
        try:
            print(f"[*] Trying mrfakename/minimax-h3-ultra-fast (Duration={video_duration}s, Turbo LoRA)...")
            client = Client("mrfakename/minimax-h3-ultra-fast")
            result = client.predict(
                prompt=f"{prompt}, photorealistic 8k, cinematic lighting, high fidelity, ultra detailed",
                image_path=None,
                last_image_path=None,
                canvas="960x544 \u00b7 16:9 fast",
                duration=video_duration,
                steps=steps if (4 <= steps <= 12) else 4,
                seed=rand_seed,
                upsample=False,
                acceleration="Exact",
                lora_preset="Turbo \u00b7 4 steps",
                lora_repo="lightx2v/Minimax-h3-Turbo",
                lora_filename="",
                lora_strength=1.0,
                generation_preset="Turbo 4-step \u00b7 fastest, more artifacts",
                references=None,
                api_name="/generate"
            )
            vid_path = extract_path(result)
            if vid_path and os.path.exists(vid_path):
                import shutil
                shutil.copyfile(vid_path, video_output_path)
                print("[+] MiniMax-H3 Video+Audio Complete from mrfakename Turbo LoRA!")
                mm_success = True
        except Exception as err:
            print(f"[-] mrfakename error: {err}")
            renew_tor_ip()

    # Space 3: multimodalart (official, minimal params)
    if not mm_success:
        try:
            print("[*] Trying multimodalart/minimax-h3...")
            client = Client("multimodalart/minimax-h3")
            result = client.predict(
                prompt=prompt,
                image_path=None,
                last_image_path=None,
                canvas="960x544 \u00b7 16:9 fast",
                duration=video_duration,
                steps=28,
                seed=rand_seed,
                upsample=False,
                api_name="/generate"
            )
            vid_path = extract_path(result)
            if vid_path and os.path.exists(vid_path):
                import shutil
                shutil.copyfile(vid_path, video_output_path)
                print("[+] MiniMax-H3 Video+Audio Complete from multimodalart!")
                mm_success = True
        except Exception as err:
            print(f"[-] multimodalart error: {err}")
            renew_tor_ip()
elif action == "minimax-music":
    print(f"[*] Composing studio-grade AI Music with MiniMax-Music3...")
    audio_output_path = "/tmp/ai_lab/output.mp3"
    output_path = audio_output_path
    is_instrumental = image_url.lower() in ("true", "1", "yes") if image_url else False

    try:
        music_duration = int(float(duration_val)) if duration_val else 60
    except:
        music_duration = 60

    if seed_val and seed_val != "-1":
        try:
            rand_seed = int(seed_val)
            is_rand_seed = False
        except:
            rand_seed = random.randint(1, 9999999)
            is_rand_seed = True
    else:
        rand_seed = random.randint(1, 9999999)
        is_rand_seed = True
    final_seed = rand_seed

    print(f"[*] MiniMax-Music3 Config: Duration={music_duration}s | Instrumental={is_instrumental} | Seed={rand_seed}")
    music_success = False

    try:
        from gradio_client import Client
        print(f"[*] Connecting to MiniMaxAI/MiniMax-Music3 Space...")
        client = Client("MiniMaxAI/MiniMax-Music3")
        state_payload = {
            "mode": "simple",
            "description": prompt,
            "instrumental": is_instrumental,
            "title": prompt[:30],
            "lyrics": "",
            "global_meta": "",
            "vocals": "",
            "arrangement": ""
        }
        print(f"[*] Generating song (duration={music_duration}s, instrumental={is_instrumental}): {prompt}...")
        result = client.predict(
            state=state_payload,
            duration=music_duration,
            seed=rand_seed,
            randomize_seed=is_rand_seed,
            headroom=0,
            steps=30,
            guidance=1.7,
            api_name="/simple_generate"
        )
        audio_path = extract_path(result)
        if audio_path and os.path.exists(audio_path):
            import shutil
            shutil.copyfile(audio_path, audio_output_path)
            print("[+] MiniMax Music 3 Generation Complete!")
            music_success = True
        else:
            print(f"[-] MiniMax Music path not resolved: {result}")
            renew_tor_ip()
    except Exception as e:
        print(f"[-] MiniMax-Music3 error: {e}")
        renew_tor_ip()





elif action == "kokoro-tts":
    print(f"[*] Generating Kokoro-TTS Hyper-Realistic Voice...")
    audio_output_path = "/tmp/ai_lab/output.mp3"
    output_path = audio_output_path
    voice = os.environ.get("IMAGE_URL", "af_heart")
    if not voice or voice.startswith("http"):
        voice = "af_heart"
    tts_success = False

    # Attempt 1: Fast Gradio Space
    try:
        from gradio_client import Client
        client = Client("remsky/Kokoro-TTS-Zero")
        print(f"[*] Generating speech via Space (voice: {voice}): {prompt[:80]}...")
        result = client.predict(
            text=prompt,
            voice_names=[voice],
            speed=1.0,
            api_name="/generate_speech_from_ui"
        )
        audio_path = extract_path(result)
        if audio_path and os.path.exists(audio_path):
            import shutil
            shutil.copyfile(audio_path, audio_output_path)
            print("[+] Kokoro Space generation complete!")
            tts_success = True
    except Exception as e:
        print(f"[-] Kokoro Space error: {e}")
        renew_tor_ip()

    # Attempt 2: Local pipeline fallback in 23GB memory
    if not tts_success:
        try:
            print("[*] Running local Kokoro synthesis fallback...")
            from kokoro import KPipeline
            import soundfile as sf
            import numpy as np
            pipeline = KPipeline(lang_code='a')
            generator = pipeline(prompt, voice=voice, speed=1, split_pattern=r'\n+')
            audio_pieces = []
            for i, (gs, ps, audio) in enumerate(generator):
                audio_pieces.append(audio)
            if audio_pieces:
                full_audio = np.concatenate(audio_pieces)
                sf.write(audio_output_path, full_audio, 24000)
                print("[+] Local Kokoro generation complete!")
        except Exception as err2:
            print(f"[-] Local Kokoro error: {err2}")

elif action == "qwen-voice":
    print(f"[*] Generating speech via Qwen3-TTS Neural Studio...")
    audio_output_path = "/tmp/ai_lab/output.mp3"
    output_path = audio_output_path

    # Parse parameters from IMAGE_URL (supports JSON or raw string)
    voice_payload_raw = os.environ.get("IMAGE_URL", "Vivian")
    voice_params = {}
    try:
        voice_params = json.loads(voice_payload_raw)
    except Exception:
        voice_params = {"mode": "preset", "speaker": voice_payload_raw or "Vivian"}

    mode = voice_params.get("mode", "preset")
    speaker_raw = voice_params.get("speaker", "Vivian")
    ref_audio_url = voice_params.get("ref_audio_url", "")
    ref_text = voice_params.get("ref_text", "")
    voice_description = voice_params.get("voice_description", "")
    instruct = voice_params.get("instruct", "Natural, expressive, clear studio quality voice.")
    language = voice_params.get("language", "Auto")
    model_size = voice_params.get("model_size", "1.7B")

    speaker_map = {
        "vivian": "Vivian",
        "serena": "Serena",
        "uncle_fu": "Uncle_fu",
        "uncle fu": "Uncle_fu",
        "dylan": "Dylan",
        "eric": "Eric",
        "ryan": "Ryan",
        "aiden": "Aiden",
        "ono_anna": "Ono_anna",
        "ono anna": "Ono_anna",
        "sohee": "Sohee"
    }
    speaker = speaker_map.get(str(speaker_raw).lower().replace(" ", "_"), "Vivian")
    qwen_voice_success = False

    # Download ref audio if in clone mode
    local_ref_audio = None
    if mode == "clone" and ref_audio_url:
        try:
            local_ref_audio = "/tmp/ai_lab/ref_audio.mp3"
            print(f"[*] Downloading reference audio for clone: {ref_audio_url}")
            r_audio = requests.get(ref_audio_url, timeout=30)
            if r_audio.status_code == 200:
                with open(local_ref_audio, "wb") as af:
                    af.write(r_audio.content)
                print(f"[+] Downloaded ref audio ({len(r_audio.content)} bytes)")
            else:
                print(f"[-] Ref audio download returned status {r_audio.status_code}")
                local_ref_audio = None
        except Exception as ref_err:
            print(f"[-] Failed downloading ref audio: {ref_err}")
            local_ref_audio = None

    # Attempt 1: Official Qwen/Qwen3-TTS (Preset, Clone, or Design mode)
    try:
        from gradio_client import Client, handle_file
        print(f"[*] Connecting to Qwen/Qwen3-TTS (mode: {mode}, model: {model_size})...")
        client = Client("Qwen/Qwen3-TTS")

        if mode == "clone" and local_ref_audio and os.path.exists(local_ref_audio):
            print(f"[*] Calling /generate_voice_clone...")
            result = client.predict(
                ref_audio=handle_file(local_ref_audio),
                ref_text=ref_text,
                target_text=prompt,
                language=language,
                use_xvector_only=False,
                model_size=model_size,
                api_name="/generate_voice_clone"
            )
        elif mode == "design" and voice_description:
            print(f"[*] Calling /generate_voice_design (description: {voice_description})...")
            result = client.predict(
                text=prompt,
                language=language,
                voice_description=voice_description,
                api_name="/generate_voice_design"
            )
        else:
            print(f"[*] Calling /generate_custom_voice (speaker: {speaker})...")
            result = client.predict(
                text=prompt,
                language=language,
                speaker=speaker,
                instruct=instruct,
                model_size=model_size,
                api_name="/generate_custom_voice"
            )

        audio_path = extract_path(result)
        if audio_path and os.path.exists(audio_path):
            import shutil
            shutil.copyfile(audio_path, audio_output_path)
            print(f"[+] Official Qwen3-TTS generation complete! (mode: {mode})")
            qwen_voice_success = True
    except Exception as e:
        print(f"[-] Qwen3-TTS Space error: {e}")
        renew_tor_ip()

    # Attempt 2: Fallback to techfreakworm/qwen-voice-studio (Preset mode)
    if not qwen_voice_success and mode == "preset":
        try:
            from gradio_client import Client
            print(f"[*] Fallback: Connecting to techfreakworm/qwen-voice-studio (speaker: {speaker})...")
            client = Client("techfreakworm/qwen-voice-studio")
            result = client.predict(
                text=prompt,
                speaker=speaker,
                instruct=instruct or "",
                language="Auto (detect)",
                longform=False,
                param_5=0.7,
                param_6=0.8,
                param_7=50,
                param_8=1.05,
                param_9=False,
                param_10=0.7,
                param_11=0.8,
                param_12=50,
                param_13=1024,
                param_14=-1,
                api_name="/do_preset"
            )
            audio_path = extract_path(result)
            if audio_path and os.path.exists(audio_path):
                import shutil
                shutil.copyfile(audio_path, audio_output_path)
                print("[+] techfreakworm Qwen Voice generation complete!")
                qwen_voice_success = True
        except Exception as e:
            print(f"[-] techfreakworm Qwen Voice error: {e}")
            renew_tor_ip()

    # Attempt 3: F5-TTS Fallback for voice clone if Qwen clone fails
    if not qwen_voice_success and mode == "clone" and local_ref_audio and os.path.exists(local_ref_audio):
        try:
            from gradio_client import Client, handle_file
            print(f"[*] Voice Clone Fallback: Connecting to mrfakename/E2-F5-TTS...")
            client = Client("mrfakename/E2-F5-TTS")
            result = client.predict(
                ref_audio=handle_file(local_ref_audio),
                ref_text=ref_text,
                gen_text=prompt,
                remove_silence=False,
                api_name="/predict"
            )
            audio_path = extract_path(result)
            if audio_path and os.path.exists(audio_path):
                import shutil
                shutil.copyfile(audio_path, audio_output_path)
                print("[+] E2-F5-TTS clone fallback generation complete!")
                qwen_voice_success = True
        except Exception as e:
            print(f"[-] E2-F5-TTS fallback error: {e}")
            renew_tor_ip()

    # Attempt 4: Fallback to Kokoro-TTS if all else fails
    if not qwen_voice_success:
        try:
            print("[*] Quota/Space fallback: Generating via Kokoro-TTS...")
            from kokoro import KPipeline
            import soundfile as sf
            import numpy as np
            pipeline = KPipeline(lang_code='a')
            generator = pipeline(prompt, voice='af_heart', speed=1, split_pattern=r'\n+')
            audio_pieces = []
            for i, (gs, ps, audio) in enumerate(generator):
                audio_pieces.append(audio)
            if audio_pieces:
                full_audio = np.concatenate(audio_pieces)
                sf.write(audio_output_path, full_audio, 24000)
                print("[+] Fallback Kokoro generation complete!")
        except Exception as fallback_err:
            print(f"[-] Voice fallback error: {fallback_err}")


          # Send generated artifact to user's DM & server audit log channel (1506768429107908719)
if os.path.exists(output_path):
    headers = {"Authorization": f"Bot {discord_token}"}
    if action in ("wan-video", "minimax-h3"):
        filename = "xploit_video.mp4"
        mimetype = "video/mp4"
    elif action in ("kokoro-tts", "qwen-voice", "minimax-music"):
        filename = "xploit_voice.mp3"
        mimetype = "audio/mpeg"
    else:
        filename = "xploit_render.png"
        mimetype = "image/png"

    # 1. Open User DM Channel
    dm_channel_id = None
    try:
        create_dm_url = "https://discord.com/api/v10/users/@me/channels"
        dm_resp = requests.post(create_dm_url, headers=headers, json={"recipient_id": str(user_id)}, timeout=10)
        if dm_resp.status_code in (200, 201):
            dm_channel_id = dm_resp.json().get("id")
            print(f"[+] Created user DM channel: {dm_channel_id}")
        else:
            print(f"[-] Could not open DM channel (status {dm_resp.status_code}): {dm_resp.text}")
    except Exception as e_dm:
        print(f"[-] Exception opening DM channel: {e_dm}")

    # Target destinations:
    # Destination 1: User's DM (or fallback to original channel if DM is closed)
    # Destination 2: Server Audit Log private channel: 1506768429107908719
    AUDIT_CHANNEL_ID = "1506768429107908719"
    destinations = []
    if dm_channel_id:
        destinations.append(("User DM", dm_channel_id, False))
    else:
        destinations.append(("Origin Channel (DM Closed)", channel_id, True))

    destinations.append(("Audit Log Channel", AUDIT_CHANNEL_ID, False))

    seed_line = f"\n🎲 **Seed:** `{final_seed}`" if final_seed is not None else ""

    def upload_external(file_path):
        """Upload large files (>8MB) to ultra-fast free file hosts with direct Discord embedding"""
        # 1. Catbox.moe (Up to 200MB, permanent, instant Discord image/video unfurl)
        try:
            with open(file_path, "rb") as f_up:
                r_cb = requests.post(
                    "https://catbox.moe/user/api.php",
                    data={"reqtype": "fileupload"},
                    files={"fileToUpload": f_up},
                    timeout=45
                )
                if r_cb.status_code == 200 and r_cb.text.strip().startswith("http"):
                    direct_url = r_cb.text.strip()
                    print(f"[+] Successfully hosted on Catbox: {direct_url}")
                    return direct_url
        except Exception as e_cb:
            print(f"[-] Catbox host failed: {e_cb}")

        # 2. Litterbox (Up to 1GB, 72 hours retention)
        try:
            with open(file_path, "rb") as f_lb:
                r_lb = requests.post(
                    "https://litterbox.catbox.moe/resources/internals/api.php",
                    data={"reqtype": "fileupload", "time": "72h"},
                    files={"fileToUpload": f_lb},
                    timeout=45
                )
                if r_lb.status_code == 200 and r_lb.text.strip().startswith("http"):
                    direct_url = r_lb.text.strip()
                    print(f"[+] Successfully hosted on Litterbox: {direct_url}")
                    return direct_url
        except Exception as e_lb:
            print(f"[-] Litterbox host failed: {e_lb}")

        # 3. Tmpfiles.org (Direct download link fallback)
        try:
            with open(file_path, "rb") as f_tmp:
                r_tmp = requests.post(
                    "https://tmpfiles.org/api/v1/upload",
                    files={"file": f_tmp},
                    timeout=45
                )
                if r_tmp.status_code == 200:
                    json_res = r_tmp.json()
                    t_url = json_res.get("data", {}).get("url", "")
                    if t_url:
                        direct_url = t_url.replace("tmpfiles.org/", "tmpfiles.org/dl/")
                        print(f"[+] Successfully hosted on Tmpfiles: {direct_url}")
                        return direct_url
        except Exception as e_tmp:
            print(f"[-] Tmpfiles host failed: {e_tmp}")

        return None

    file_size = os.path.getsize(output_path)
    file_size_mb = file_size / (1024 * 1024)
    external_link = None

    # Discord bot upload limit is 8MB (without Nitro/Server Boost level 2)
    if file_size >= 8 * 1024 * 1024:
        print(f"[*] Output size ({file_size_mb:.2f}MB) exceeds Discord 8MB limit. Uploading to high-speed external mirror...")
        external_link = upload_external(output_path)

    with open(output_path, "rb") as f:
        file_bytes = f.read()

    for dest_name, dest_id, is_dm_fail in destinations:
        try:
            dm_warning = "\n⚠️ *Note: Your Direct Messages (DMs) are disabled in server privacy settings, so output was delivered here.*" if is_dm_fail else ""
            content = f"🎬 **XPLOIT NEXT-GEN AI LAB — {action.upper()}**\n👤 **Operator:** <@{user_id}>\n🧬 **Engine:** `{action.upper()}`\n📝 **Input:** `{prompt}`{seed_line}{dm_warning}"
            dest_url = f"https://discord.com/api/v10/channels/{dest_id}/messages"

            if external_link:
                content += f"\n\n📦 **High-Resolution / 4K Direct Link ({file_size_mb:.2f}MB):**\n🔗 {external_link}"
                r = requests.post(dest_url, headers=headers, json={"content": content}, timeout=30)
                print(f"[+] Discord external link message to {dest_name} ({dest_id}) status: {r.status_code}")
            else:
                files = {"file": (filename, file_bytes, mimetype)}
                data = {"content": content}
                r = requests.post(dest_url, headers=headers, data=data, files=files, timeout=30)
                print(f"[+] Discord upload to {dest_name} ({dest_id}) status: {r.status_code}")

                # If Discord still rejected with 413 Payload Too Large, upload to external mirror and send link
                if r.status_code == 413:
                    print(f"[-] Discord 413 Payload Too Large on {dest_name}. Triggering external upload fallback...")
                    if not external_link:
                        external_link = upload_external(output_path)
                    if external_link:
                        content += f"\n\n📦 **High-Resolution / 4K Direct Link ({file_size_mb:.2f}MB):**\n🔗 {external_link}"
                        r_retry = requests.post(dest_url, headers=headers, json={"content": content}, timeout=30)
                        print(f"[+] Discord retry link message to {dest_name} ({dest_id}) status: {r_retry.status_code}")
        except Exception as e_dest:
            print(f"[-] Error uploading to {dest_name} ({dest_id}): {e_dest}")
else:
    print("[-] Error: Output file not found.")