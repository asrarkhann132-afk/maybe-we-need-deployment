import {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    EmbedBuilder,
    ActivityType,
    PermissionFlagsBits,
} from "discord.js";
import { Octokit } from "@octokit/rest";
import fs from "fs";
import "dotenv/config";

const XPLOIT_HUB_ID = "1459402620199374872";
const REPO_OWNER = "asrarkhann116-ops";
const REPO_NAME = "Xploit-hub-vps";
const VPS_CHANNEL_ID = "1497364285645652098";
const LIVE_CHANNEL_ID = process.env.LIVE_CHANNEL_ID || "1497421615590539274";
const COOLDOWN_MS = 15 * 60 * 1000;

// Admins who can run multiple VPS slots simultaneously with no cooldown
const SUPER_ADMINS = new Set(["1104652354655113268"]);

// AI Lab Cooldown: 1:30 min (90s) for regular users, 0 cooldown for Admin
const AI_LAB_COOLDOWN_MS = 90 * 1000;
const aiLabCooldowns = new Map();
// AI Lab Command Dedicated Channels
const AI_COMMAND_CHANNELS = {
    "zimage": "1549262502972620921",
    "qwen-edit": "1549262544047440043",
    "qwen21-unrestricted": "1552094478569963611",
    "flux-klein": "1549262578138615889",
    "krea": "1549262620710666270",
    "krea-2": "1549262620710666270",
    "wan-video": "1549262663874252951",
    "pixel-perfect": "1554594071979491448",
    "minimax": "1549262751958827130",
    "minimax-h3": "1549262751958827130",
    "music": "1549262789753704449",
    "minimax-music": "1549262789753704449",
    "yue": "1549262843197521960",
    "yue-music": "1549262843197521960",
    "kokoro": "1549262935552041060",
    "kokoro-tts": "1549262935552041060",
    "qwen-voice": "1549262974441750579",
    "breeze": "1549263004229697556",
    "breeze-tts": "1549263004229697556",
    "step-music": "1549870041057595413",
    "triposplat": "1549946164709687316",
    "openvoice": "1549948115900178513",
    "wan-animate": "1549949884017152030",
    "viggle": "1549950029999902820",
    "hq-video": "1549950167908753478",
    "dream-video": "1549951104253435924",
};

const AI_LAB_COMMANDS = new Set([
    "zimage",
    "qwen-edit",
    "qwen21-unrestricted",
    "flux-klein",
    "wan-video",
    "pixel-perfect",
    "krea-2",
    "krea",
    "minimax",
    "kokoro-tts",
    "kokoro",
    "qwen-voice",
    "minimax-music",
    "music",
    "yue",
    "yue-music",
    "breeze",
    "breeze-tts",
    "step-music",
    "triposplat",
    "openvoice",
    "wan-animate",
    "viggle",
    "hq-video",
    "dream-video",
]);

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// ═══════════════════════════════════════════════════════════════
// MULTI-CLUSTER WORKER POOL (Dynamic from env — zero hardcoded tokens)
// Add clusters via Railway env: GH_TOKEN_2, GH_OWNER_2, GH_REPO_2, etc.
// ═══════════════════════════════════════════════════════════════
const MAX_PER_CLUSTER = 20;
const WORKER_POOL = [];

// Cluster 1 (Mother — always exists)
WORKER_POOL.push({
    id: 1,
    name: "Cluster-1",
    owner: process.env.GH_OWNER_1 || REPO_OWNER,
    repo: process.env.GH_REPO_1 || REPO_NAME,
    octokit: new Octokit({ auth: process.env.GH_TOKEN_1 || process.env.GITHUB_TOKEN }),
});

// Auto-discover Cluster 2..20 from env variables
for (let i = 2; i <= 20; i++) {
    const token = process.env[`GH_TOKEN_${i}`];
    if (!token) continue;
    WORKER_POOL.push({
        id: i,
        name: `Cluster-${i}`,
        owner: process.env[`GH_OWNER_${i}`] || REPO_OWNER,
        repo: process.env[`GH_REPO_${i}`] || REPO_NAME,
        octokit: new Octokit({ auth: token }),
    });
}

console.log(`⚡ Worker Pool: ${WORKER_POOL.length} cluster(s) loaded (${WORKER_POOL.length * MAX_PER_CLUSTER} max slots)`);

// Smart Load Balancer — picks cluster with fewest active sessions
function getNextWorker() {
    let best = WORKER_POOL[0];
    let bestLoad = Infinity;
    for (const w of WORKER_POOL) {
        // failedLoad artificially bumps the load of a failing cluster so we don't pick it again immediately
        const load = db.sessions.filter(s => s.clusterId === w.id).length + (w.failedLoad || 0);
        if (load < bestLoad && load < MAX_PER_CLUSTER) {
            bestLoad = load;
            best = w;
        }
    }
    return best || WORKER_POOL[0];
}

// Smart Dispatch Proxy — ALL existing dispatch calls auto-route through this
// No need to change any individual command handler!
const octokit = {
    _lastWorker: WORKER_POOL[0],
    _nextWorker: null,
    actions: {
        createWorkflowDispatch: async (params) => {
            let worker = octokit._nextWorker || getNextWorker();
            octokit._nextWorker = null;
            
            const maxRetries = 4;
            let attempt = 0;
            
            while (attempt < maxRetries) {
                try {
                    params.owner = worker.owner;
                    params.repo = worker.repo;
                    octokit._lastWorker = worker;
                    const res = await worker.octokit.actions.createWorkflowDispatch(params);
                    // On success, reset any penalties
                    worker.failedLoad = 0;
                    return res;
                } catch (error) {
                    attempt++;
                    console.error(`[Auto-Heal] Dispatch failed on ${worker.name} (Attempt ${attempt}/${maxRetries}):`, error.message);
                    
                    // Penalize this dead cluster so the load balancer ignores it for a while
                    worker.failedLoad = (worker.failedLoad || 0) + 100;
                    
                    if (attempt < maxRetries) {
                        worker = getNextWorker(); // Pick a new, healthy cluster
                    } else {
                        throw error; // All retries exhausted
                    }
                }
            }
        },
    },
};

const OS_MAP = {
    tiny10: {
        label: "Tiny10 (Debloated Win10)",
        workflow: "tiny10.yml",
        access: "rdp",
        icon: "🪶",
    },
    tiny11: {
        label: "Tiny11 (Debloated Win11)",
        workflow: "tiny11.yml",
        access: "rdp",
        icon: "🪶",
    },
    windows10: {
        label: "Windows 10",
        workflow: "rdp.yml",
        access: "rdp",
        icon: "👾",
    },
    windows11: {
        label: "Windows 11",
        workflow: "win11.yml",
        access: "rdp",
        icon: "🍷",
    },
    vpn: {
        label: "VPN Server",
        workflow: "vpn.yml",
        access: "vpn",
        icon: "🔒",
    },
    proxy: {
        label: "SOCKS5 Proxy",
        workflow: "proxy.yml",
        access: "proxy",
        icon: "🌐",
    },
};

const WALLPAPER_MAP = {
    wall_default:  "https://raw.githubusercontent.com/asrarkhann116-ops/Xploit-hub-vps/main/xploit_hub_vps_wallpaper.png",
    wall_skull:    "https://images.wallpapersden.com/image/download/red-hacker-binary-code_bWZtZ2aUmZqaraWkpJRmbmdlrWZnZWU.jpg",
    wall_cyber:    "https://wallpapercave.com/wp/wp4906542.jpg",
    wall_matrix:   "https://wallpaperaccess.com/full/11554.jpg",
    wall_kali1:    "https://images.wallpapersden.com/image/download/kali-linux_bGpqZGaUmZqaraWkpJRmbmdlrWZnZWU.jpg",
    wall_kali2:    "https://images.wallpapersden.com/image/download/kali-linux-hacker_bGZlZ2WUmZqaraWkpJRmbmdlrWZnZWU.jpg",
    wall_dark:     "https://images.wallpapersden.com/image/download/dark-hacker_bWZpZWWUmZqaraWkpJRmbmdlrWZnZWU.jpg",
    wall_terminal: "https://images.wallpapersden.com/image/download/hacker-terminal_bGZoaGWUmZqaraWkpJRmbmdlrWZnZWU.jpg",
};

const commands = [
    new SlashCommandBuilder()
        .setName("vps")
        .setDescription("Launch a free VPS — pick any OS")
        .addStringOption((o) =>
            o
                .setName("os")
                .setDescription("Which operating system?")
                .setRequired(true)
                .addChoices(
                    { name: "🪶  Tiny10        (RDP)", value: "tiny10" },
                    { name: "🪶  Tiny11        (RDP)", value: "tiny11" },
                    { name: "🪟  Windows 10    (RDP)", value: "windows10" },
                    { name: "🪟  Windows 11    (RDP)", value: "windows11" },
                ),
        )
        .addStringOption((o) =>
            o
                .setName("duration")
                .setDescription("How long?")
                .setRequired(true)
                .addChoices(
                    { name: "15 Minutes", value: "15" },
                    { name: "30 Minutes", value: "30" },
                    { name: "1 Hour", value: "60" },
                    { name: "2 Hours", value: "120" },
                    { name: "4 Hours", value: "240" },
                    { name: "6 Hours", value: "360" },
                ),
        )
        .addStringOption((o) =>
            o
                .setName("wallpaper")
                .setDescription("Desktop wallpaper (Custom/Default)")
                .setRequired(false)
                .addChoices(
                    { name: "🔥 Xploit HUB VPS (Default)",    value: "wall_default"  },
                    { name: "💀 Kali Red Binary",             value: "wall_skull"    },
                    { name: "🐉 Kali Linux Official",         value: "wall_kali1"    },
                    { name: "👾 Kali Hacker Dark",            value: "wall_kali2"    },
                    { name: "🖥️ Hacker Terminal Green",       value: "wall_terminal" },
                    { name: "🌑 Dark Hacker",                 value: "wall_dark"     },
                    { name: "⚡ Cyberpunk Red",               value: "wall_cyber"    },
                    { name: "🟩 Dark Matrix",                 value: "wall_matrix"   },
                ),
        ),

    new SlashCommandBuilder()
        .setName("vps-status")
        .setDescription("Check your current VPS session"),

    new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Check bot latency and uptime"),

    new SlashCommandBuilder()
        .setName("tools")
        .setDescription("Show all available tools for an OS")
        .addStringOption((o) =>
            o
                .setName("os")
                .setDescription("Which OS tools to list?")
                .setRequired(true)
                .addChoices(
                    { name: "💀 Kali Linux (100+ tools)", value: "kali"    },
                    { name: "🐧 Ubuntu",                  value: "ubuntu"  },
                    { name: "🦜 Parrot OS",               value: "parrot"  },
                    { name: "🌀 Debian",                  value: "debian"  },
                ),
        ),

    new SlashCommandBuilder()
        .setName("vpn")
        .setDescription("Launch a free VPN — 1Gbps bore.pub tunnel, up to 6 hours")
        .addStringOption((o) =>
            o
                .setName("duration")
                .setDescription("How long?")
                .setRequired(true)
                .addChoices(
                    { name: "15 Minutes", value: "15" },
                    { name: "30 Minutes", value: "30" },
                    { name: "1 Hour",     value: "60" },
                    { name: "2 Hours",    value: "120" },
                    { name: "4 Hours",    value: "240" },
                    { name: "6 Hours",    value: "360" },
                ),
        ),

    new SlashCommandBuilder()
        .setName("proxy")
        .setDescription("Launch a free SOCKS5 proxy — 1Gbps bore.pub tunnel, up to 6 hours")
        .addStringOption((o) =>
            o
                .setName("duration")
                .setDescription("How long?")
                .setRequired(true)
                .addChoices(
                    { name: "15 Minutes", value: "15" },
                    { name: "30 Minutes", value: "30" },
                    { name: "1 Hour",     value: "60" },
                    { name: "2 Hours",    value: "120" },
                    { name: "4 Hours",    value: "240" },
                    { name: "6 Hours",    value: "360" },
                ),
        ),

    new SlashCommandBuilder()
        .setName("vps-admin")
        .setDescription("Admin: manage VPS sessions")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand((s) =>
            s.setName("list").setDescription("List all active sessions"),
        )
        .addSubcommand((s) =>
            s
                .setName("kick")
                .setDescription("Remove a user session")
                .addUserOption((o) =>
                    o
                        .setName("user")
                        .setDescription("User to kick")
                        .setRequired(true),
                ),
        )
        .addSubcommand((s) =>
            s.setName("clear").setDescription("Wipe ALL sessions"),
        )
        .addSubcommand((s) =>
            s
                .setName("announce")
                .setDescription("DM all active VPS users a message")
                .addStringOption((o) =>
                    o
                        .setName("message")
                        .setDescription("Message to broadcast")
                        .setRequired(true),
                ),
        ),

    new SlashCommandBuilder()
        .setName("zimage")
        .setDescription("⚡ Unrestricted S3-DiT Fast AI Image Gen (Tongyi-MAI Z-Image-Turbo)")
        .addStringOption((o) =>
            o
                .setName("prompt")
                .setDescription("What image do you want to generate? (Unrestricted)")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("ratio")
                .setDescription("Aspect Ratio / Canvas shape")
                .setRequired(false)
                .addChoices(
                    { name: "1:1 (Square - 1024x1024)", value: "1:1" },
                    { name: "16:9 (Landscape - 1344x768)", value: "16:9" },
                    { name: "9:16 (Portrait - 768x1344)", value: "9:16" },
                ),
        )
        .addIntegerOption((o) =>
            o
                .setName("steps")
                .setDescription("Inference steps (default: 8)")
                .setRequired(false)
                .setMinValue(4)
                .setMaxValue(20),
        )
        .addIntegerOption((o) =>
            o
                .setName("seed")
                .setDescription("Seed number (default: random)")
                .setRequired(false),
        ),

    new SlashCommandBuilder()
        .setName("qwen-edit")
        .setDescription("🧠 Unrestricted 20B AI Image Inpainting & Instruction Editing (Qwen-Image-Edit-2511)")
        .addAttachmentOption((o) =>
            o
                .setName("image")
                .setDescription("Source image to modify/edit")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("prompt")
                .setDescription("Edit instruction (e.g. 'add cyberpunk neon visor and glowing red katana')")
                .setRequired(true),
        )
        .addBooleanOption((o) =>
            o
                .setName("flux_upscale")
                .setDescription("⚡ Auto-chain with FLUX.2 Klein for 4K UltraSharp Depth & Realism Upscaling")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("quality")
                .setDescription("Output quality mode (default: Fast — ZeroGPU safe)")
                .setRequired(false)
                .addChoices(
                    { name: "⚡ Fast — ZeroGPU Safe (Default)", value: "fast" },
                    { name: "💎 Ultra — Max Resolution & Steps (may queue longer)", value: "ultra" },
                ),
        )
        .addStringOption((o) =>
            o
                .setName("style")
                .setDescription("LoRA / Quality style (default: Ultra-Realistic 4K)")
                .setRequired(false)
                .addChoices(
                    { name: "📸 Ultra-Realistic 4K (Default)", value: "Ultrarealistic-Portrait" },
                    { name: "🔍 Super 2K/4K Upscale", value: "Upscale2K" },
                    { name: "🌟 Semi-Realistic Photo Detailer", value: "Semirealistic-photo-detailer" },
                    { name: "💡 Relight & Studio Lighting", value: "Relight" },
                    { name: "🎭 Face & Identity Swap", value: "BFS-Best-FaceSwap" },
                    { name: "🎨 Raw / Natural (No LoRA)", value: "None" },
                ),
        )
        .addIntegerOption((o) =>
            o
                .setName("steps")
                .setDescription("Inference steps (default: 6, range: 4-30)")
                .setRequired(false)
                .setMinValue(4)
                .setMaxValue(50),
        )
        .addIntegerOption((o) =>
            o
                .setName("seed")
                .setDescription("Seed number (default: random)")
                .setRequired(false),
        ),

    new SlashCommandBuilder()
        .setName("qwen21-unrestricted")
        .setDescription("🔥 Qwen-Image-2.1 Uncensored GGUF Studio — Multi-Mode Image Gen & Editing")
        .addStringOption((o) =>
            o
                .setName("prompt")
                .setDescription("Image description or editing instruction (Unrestricted)")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("mode")
                .setDescription("Generation mode (default: Create an image)")
                .setRequired(false)
                .addChoices(
                    { name: "🎨 Create an image (Text-to-Image)", value: "Create an image" },
                    { name: "✏️ Edit an image (Image-to-Image)", value: "Edit an image" },
                    { name: "🪄 Transparent PNG (Cutout)", value: "Transparent PNG" },
                ),
        )
        .addAttachmentOption((o) =>
            o
                .setName("reference")
                .setDescription("Reference image (required for Edit mode & Transparent PNG)")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("ratio")
                .setDescription("Aspect Ratio / Canvas shape")
                .setRequired(false)
                .addChoices(
                    { name: "Square · 1:1 (1024x1024)", value: "Square · 1:1 (1024x1024)" },
                    { name: "Landscape · 16:9 (1344x768)", value: "Landscape · 16:9 (1344x768)" },
                    { name: "Portrait · 9:16 (768x1344)", value: "Portrait · 9:16 (768x1344)" },
                    { name: "Landscape · 4:3 (1152x864)", value: "Landscape · 4:3 (1152x864)" },
                    { name: "Portrait · 3:4 (864x1152)", value: "Portrait · 3:4 (864x1152)" },
                ),
        )
        .addIntegerOption((o) =>
            o
                .setName("steps")
                .setDescription("Inference steps (default: 40, recommended for quality. Use 10-20 for fast preview)")
                .setRequired(false)
                .setMinValue(4)
                .setMaxValue(40),
        )
        .addIntegerOption((o) =>
            o
                .setName("seed")
                .setDescription("Seed number (default: random)")
                .setRequired(false),
        )
        .addBooleanOption((o) =>
            o
                .setName("randomize_seed")
                .setDescription("Randomize seed? (default: true)")
                .setRequired(false),
        ),

    new SlashCommandBuilder()
        .setName("flux-klein")
        .setDescription("⚡ FLUX.2 Klein Multi-LoRA 4K UltraSharp Depth & Photorealism Engine")
        .addStringOption((o) =>
            o
                .setName("prompt")
                .setDescription("Image description or upscale enhancement prompt")
                .setRequired(true),
        )
        .addAttachmentOption((o) =>
            o
                .setName("image")
                .setDescription("Base image to upscale / enhance (optional for text-to-image)")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("upscale_factor")
                .setDescription("Super-resolution upscale model (default: 4x UltraSharp)")
                .setRequired(false)
                .addChoices(
                    { name: "⚡ 4× UltraSharp (Crisp 4K)", value: "4× — UltraSharp (crisp)" },
                    { name: "📸 4× Nomos2 HQ (Photography 4K)", value: "4× — Nomos2 HQ DAT2 (Photography)" },
                    { name: "🌿 4× Remacri (Natural Photo 4K)", value: "4× — Remacri (natural)" },
                    { name: "⚖️ 2× RealESRGAN (Balanced HD)", value: "2× — RealESRGAN (balanced)" },
                    { name: "🎨 Native 1× (No External Upscale)", value: "None" },
                ),
        )
        .addStringOption((o) =>
            o
                .setName("style")
                .setDescription("LoRA Multi-Stack Preset (default: Ultimate Upscaler + High-Res)")
                .setRequired(false)
                .addChoices(
                    { name: "💎 Ultimate Upscaler + High-Res (Default)", value: "upscaler_hi_res" },
                    { name: "📸 InstaPic Photorealism", value: "instapic" },
                    { name: "💡 Klein Delight + Studio Lighting", value: "delight" },
                    { name: "🎭 Best Face Swap & Identity Consistency", value: "face_swap" },
                    { name: "🎨 Raw / Natural (No LoRA)", value: "none" },
                ),
        )
        .addIntegerOption((o) =>
            o
                .setName("steps")
                .setDescription("Inference steps (default: 4, range: 2-15)")
                .setRequired(false)
                .setMinValue(2)
                .setMaxValue(15),
        )
        .addIntegerOption((o) =>
            o
                .setName("seed")
                .setDescription("Seed number (default: random)")
                .setRequired(false),
        ),

    new SlashCommandBuilder()
        .setName("wan-video")
        .setDescription("🎬 Wan 2.2 I2V 14B High-Speed AI Video Generation (Image-to-Video)")
        .addAttachmentOption((o) =>
            o
                .setName("image")
                .setDescription("Base image to bring to life into an animated video")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("prompt")
                .setDescription("Motion prompt (e.g. 'cinematic camera pan, hair blowing in wind, 4k ultra quality')")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("duration")
                .setDescription("Video duration in seconds")
                .setRequired(false)
                .addChoices(
                    { name: "3.5s (Fast Turbo)", value: "3.5" },
                    { name: "5.0s (Standard HD)", value: "5" },
                    { name: "6.0s (Extended)", value: "6" },
                    { name: "8.0s (Long Play)", value: "8" },
                    { name: "10.0s (Maximum Studio)", value: "10" },
                ),
        )
        .addIntegerOption((o) =>
            o
                .setName("steps")
                .setDescription("Inference steps (default: 6)")
                .setRequired(false)
                .setMinValue(4)
                .setMaxValue(12),
        )
        .addIntegerOption((o) =>
            o
                .setName("seed")
                .setDescription("Seed number (default: random)")
                .setRequired(false),
        ),

    new SlashCommandBuilder()
        .setName("pixel-perfect")
        .setDescription("🎥 Perfect Pixel Engine 1.0 — Premium Custom LoRA I2V 14B (13-Second Max Studio Quality)")
        .addAttachmentOption((o) =>
            o
                .setName("input_image")
                .setDescription("Primary input image to animate into video")
                .setRequired(true),
        )
        .addAttachmentOption((o) =>
            o
                .setName("last_image")
                .setDescription("Optional: Last frame image for trajectory guidance")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("prompt")
                .setDescription("Motion/scene prompt (e.g. 'cinematic camera dolly, particles drift, ultra hd 4k')")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("duration")
                .setDescription("Video duration in seconds (max 13s)")
                .setRequired(false)
                .addChoices(
                    { name: "3.5s (Fast Turbo)", value: "3.5" },
                    { name: "5.0s (Standard HD)", value: "5" },
                    { name: "6.5s (Extended)", value: "6.5" },
                    { name: "8.0s (Long Play)", value: "8" },
                    { name: "10.0s (Ultra Studio)", value: "10" },
                    { name: "13.0s (Maximum Studio)", value: "13" },
                ),
        )
        .addIntegerOption((o) =>
            o
                .setName("steps")
                .setDescription("Inference steps (default: 6, range: 4-12)")
                .setRequired(false)
                .setMinValue(4)
                .setMaxValue(12),
        )
        .addNumberOption((o) =>
            o
                .setName("guidance_scale")
                .setDescription("Prompt adherence strength (default: 2.5, range: 1.0-5.0)")
                .setRequired(false)
                .setMinValue(1.0)
                .setMaxValue(5.0),
        )
        .addIntegerOption((o) =>
            o
                .setName("seed")
                .setDescription("Seed number (default: random)")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("quality")
                .setDescription("Output quality preset")
                .setRequired(false)
                .addChoices(
                    { name: "Normal (Balanced)", value: "normal" },
                    { name: "High (Detailed)", value: "high" },
                ),
        )
        .addStringOption((o) =>
            o
                .setName("scheduler")
                .setDescription("Diffusion scheduler algorithm")
                .setRequired(false)
                .addChoices(
                    { name: "Euler", value: "euler" },
                    { name: "DDIM", value: "ddim" },
                    { name: "DPM Solver", value: "dpm_solver" },
                ),
        )
        .addStringOption((o) =>
            o
                .setName("frame_multiplier")
                .setDescription("Frame density/temporal resolution")
                .setRequired(false)
                .addChoices(
                    { name: "16 (Economy)", value: "16" },
                    { name: "32 (Standard)", value: "32" },
                    { name: "64 (High Fidelity)", value: "64" },
                    { name: "128 (Ultra Smooth)", value: "128" },
                ),
        )
        .addBooleanOption((o) =>
            o
                .setName("safe_mode")
                .setDescription("Enable safe content filter? (default: false)")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("lora_preset_1")
                .setDescription("LoRA Preset Slot 1: Specialist Style Enhancement")
                .setRequired(false)
                .addChoices(
                    { name: "None", value: "none" },
                    { name: "Cinematic Film Look", value: "cinematic" },
                    { name: "Anime Enhanced", value: "anime" },
                    { name: "Photorealistic Boost", value: "photorealistic" },
                ),
        )
        .addStringOption((o) =>
            o
                .setName("lora_preset_2")
                .setDescription("LoRA Preset Slot 2: Motion & Camera Dynamics")
                .setRequired(false)
                .addChoices(
                    { name: "None", value: "none" },
                    { name: "Smooth Camera Motion", value: "camera_smooth" },
                    { name: "Dynamic Movement", value: "dynamic" },
                ),
        )
        .addStringOption((o) =>
            o
                .setName("lora_preset_3")
                .setDescription("LoRA Preset Slot 3: Lighting & Atmosphere")
                .setRequired(false)
                .addChoices(
                    { name: "None", value: "none" },
                    { name: "Studio Lighting", value: "studio_light" },
                    { name: "Atmospheric Depth", value: "atmosphere" },
                ),
        )
        .addStringOption((o) =>
            o
                .setName("custom_lora_1")
                .setDescription("Custom LoRA URL/Path Slot 1 (advanced users)")
                .setRequired(false),
        )
        .addNumberOption((o) =>
            o
                .setName("custom_lora_1_weight")
                .setDescription("Custom LoRA 1 weight (default: 1.0, range: 0.0-2.0)")
                .setRequired(false)
                .setMinValue(0.0)
                .setMaxValue(2.0),
        )
        .addStringOption((o) =>
            o
                .setName("custom_lora_2")
                .setDescription("Custom LoRA URL/Path Slot 2 (advanced users)")
                .setRequired(false),
        )
        .addNumberOption((o) =>
            o
                .setName("custom_lora_2_weight")
                .setDescription("Custom LoRA 2 weight (default: 1.0, range: 0.0-2.0)")
                .setRequired(false)
                .setMinValue(0.0)
                .setMaxValue(2.0),
        ),

    new SlashCommandBuilder()
        .setName("krea")
        .setDescription("🔞 Krea-2-Turbo Ultra-Realistic Photorealism & LoRA Engine (Zero Restrictions)")
        .addStringOption((o) =>
            o
                .setName("prompt")
                .setDescription("What to generate? (e.g. 'portrait of a cybernetic warrior in neon rain')")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("ratio")
                .setDescription("Aspect Ratio / Canvas shape")
                .setRequired(false)
                .addChoices(
                    { name: "1:1 (Square - 1024x1024)", value: "1:1" },
                    { name: "16:9 (Landscape - 1280x720)", value: "16:9" },
                    { name: "9:16 (Portrait - 720x1280)", value: "9:16" },
                ),
        )
        .addIntegerOption((o) =>
            o
                .setName("steps")
                .setDescription("Inference steps (default: 8)")
                .setRequired(false)
                .setMinValue(4)
                .setMaxValue(15),
        )
        .addIntegerOption((o) =>
            o
                .setName("seed")
                .setDescription("Seed number (default: random)")
                .setRequired(false),
        ),

    new SlashCommandBuilder()
        .setName("minimax")
        .setDescription("🎬 MiniMax-H3 Uncensored AI Video + Synced Audio Engine (Hailuo 3 T2VA)")
        .addStringOption((o) =>
            o
                .setName("prompt")
                .setDescription("Video scene to generate with synced audio (e.g. 'Sports car drifting in neon rain')")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("duration")
                .setDescription("Video duration in seconds")
                .setRequired(false)
                .addChoices(
                    { name: "3.5s (Fast Turbo - Recommended)", value: "3.5" },
                    { name: "5.0s (Standard Cinematic)", value: "5" },
                    { name: "6.0s (Extended)", value: "6" },
                    { name: "8.0s (Long Play)", value: "8" },
                    { name: "10.0s (Maximum Studio)", value: "10" },
                ),
        )
        .addIntegerOption((o) =>
            o
                .setName("steps")
                .setDescription("Inference steps (default: 4)")
                .setRequired(false)
                .setMinValue(4)
                .setMaxValue(12),
        )
        .addIntegerOption((o) =>
            o
                .setName("seed")
                .setDescription("Seed number (default: random)")
                .setRequired(false),
        ),

    new SlashCommandBuilder()
        .setName("kokoro")
        .setDescription("🎙️ Kokoro-TTS Ultra-Realistic Natural Voice Synthesis (Zero-Shot)")
        .addStringOption((o) =>
            o
                .setName("text")
                .setDescription("What should the voice say?")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("voice")
                .setDescription("Voice preset")
                .setRequired(false)
                .addChoices(
                    { name: "Heart (Female - Sweet & Warm)", value: "af_heart" },
                    { name: "Bella (Female - Expressive)", value: "af_bella" },
                    { name: "Nicole (Female - Soft Whisper)", value: "af_nicole" },
                    { name: "Adam (Male - Deep & Confident)", value: "am_adam" },
                    { name: "Michael (Male - Narrator)", value: "am_michael" },
                    { name: "Emma (British Female - Posh)", value: "bf_emma" },
                    { name: "George (British Male - Classic)", value: "bm_george" },
                ),
        ),
    new SlashCommandBuilder()
        .setName("qwen-voice")
        .setDescription("🎙️ Qwen3-TTS Studio — Preset Speakers | Voice Clone | Voice Design (1.7B)")
        .addStringOption((o) =>
            o
                .setName("text")
                .setDescription("Text to synthesize into speech")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("mode")
                .setDescription("TTS mode (default: preset speaker)")
                .setRequired(false)
                .addChoices(
                    { name: "🎭 Preset Speaker (built-in voices)", value: "preset" },
                    { name: "🧬 Voice Clone (upload reference audio)", value: "clone" },
                    { name: "🎨 Voice Design (describe a voice)", value: "design" },
                ),
        )
        .addStringOption((o) =>
            o
                .setName("speaker")
                .setDescription("Preset speaker (for Preset mode)")
                .setRequired(false)
                .addChoices(
                    { name: "Vivian (Natural Female)", value: "Vivian" },
                    { name: "Serena (Warm Female)", value: "Serena" },
                    { name: "Uncle Fu (Mature Deep Male)", value: "Uncle_Fu" },
                    { name: "Dylan (Confident Male)", value: "Dylan" },
                    { name: "Eric (Casual Male)", value: "Eric" },
                    { name: "Ryan (Energetic Male)", value: "Ryan" },
                    { name: "Aiden (Clear Male)", value: "Aiden" },
                    { name: "Ono Anna (Japanese Voice)", value: "Ono_Anna" },
                    { name: "Sohee (Korean Voice)", value: "Sohee" },
                ),
        )
        .addAttachmentOption((o) =>
            o
                .setName("ref_audio")
                .setDescription("Reference audio file for voice cloning (for Clone mode, .mp3/.wav)")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("ref_text")
                .setDescription("Transcript of the reference audio (for Clone mode — improves accuracy)")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("voice_description")
                .setDescription("Describe the voice you want (for Design mode, e.g. 'deep, calm male voice')")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("instruct")
                .setDescription("Emotion/style instruction (e.g. 'speak with excitement', 'whisper softly')")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("language")
                .setDescription("Target language (default: Auto-detect)")
                .setRequired(false)
                .addChoices(
                    { name: "🌐 Auto Detect", value: "Auto" },
                    { name: "🇬🇧 English", value: "English" },
                    { name: "🇨🇳 Chinese", value: "Chinese" },
                    { name: "🇯🇵 Japanese", value: "Japanese" },
                    { name: "🇰🇷 Korean", value: "Korean" },
                    { name: "🇫🇷 French", value: "French" },
                    { name: "🇩🇪 German", value: "German" },
                    { name: "🇪🇸 Spanish", value: "Spanish" },
                    { name: "🇧🇷 Portuguese", value: "Portuguese" },
                    { name: "🇷🇺 Russian", value: "Russian" },
                ),
        )
        .addStringOption((o) =>
            o
                .setName("model_size")
                .setDescription("Model size (default: 1.7B — best quality)")
                .setRequired(false)
                .addChoices(
                    { name: "1.7B (Best Quality)", value: "1.7B" },
                    { name: "0.6B (Faster)", value: "0.6B" },
                ),
        ),
    new SlashCommandBuilder()
        .setName("music")
        .setDescription("🎵 AI Full Song & Instrumental Generator (MiniMax Music 3 / YuE 2)")
        .addStringOption((o) =>
            o
                .setName("prompt")
                .setDescription("Song description or style (e.g. 'romantic acoustic guitar ballad, warm female vocals')")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("engine")
                .setDescription("AI Music Engine (default: MiniMax Music 3)")
                .setRequired(false)
                .addChoices(
                    { name: "🎵 MiniMax Music 3 (Fast Full Song & Instrumentals)", value: "minimax" },
                    { name: "🔥 YuE 2 (3B) — CoT Reasoning & Custom Lyrics", value: "yue" },
                ),
        )
        .addStringOption((o) =>
            o
                .setName("lyrics")
                .setDescription("Custom lyrics with structure tags ([verse], [chorus]) for YuE 2 / vocal mode")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("duration")
                .setDescription("Song duration (MiniMax Music)")
                .setRequired(false)
                .addChoices(
                    { name: "30s (Sample Preview)", value: "30" },
                    { name: "60s (Standard 1 Min)", value: "60" },
                    { name: "120s (2 Minutes Full Track)", value: "120" },
                    { name: "180s (3 Minutes Extended)", value: "180" },
                    { name: "240s (4 Minutes Full Album Track)", value: "240" },
                ),
        )
        .addBooleanOption((o) =>
            o
                .setName("instrumental")
                .setDescription("Instrumental only (no vocals)?")
                .setRequired(false),
        )
        .addIntegerOption((o) =>
            o
                .setName("seed")
                .setDescription("Seed number (default: random)")
                .setRequired(false),
        ),
    new SlashCommandBuilder()
        .setName("yue")
        .setDescription("🎵 YuE 2 (3B) — CoT Full Song & Instrumental Generator (Vocals + Lyrics + Melody)")
        .addStringOption((o) =>
            o
                .setName("prompt")
                .setDescription("Song style, genre, instruments & vocals (e.g. 'Cyber metal, aggressive vocals')")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("lyrics")
                .setDescription("Custom song lyrics with tags ([verse], [chorus]). Leave blank for auto.")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("cot")
                .setDescription("Chain-of-Thought planning mode (default: Full CoT)")
                .setRequired(false)
                .addChoices(
                    { name: "🧠 Full CoT (Highest coherence, melody & structure)", value: "full" },
                    { name: "🎼 Melody CoT (Melodic planning only)", value: "melody" },
                    { name: "⚡ Off (Direct generation — fastest)", value: "off" },
                ),
        )
        .addStringOption((o) =>
            o
                .setName("quality")
                .setDescription("Render quality steps (default: 16 - Fast Studio)")
                .setRequired(false)
                .addChoices(
                    { name: "⚡ Fast Studio (16 Steps)", value: "16" },
                    { name: "💎 Ultra High-Fidelity (32 Steps)", value: "32" },
                ),
        )
        .addIntegerOption((o) =>
            o
                .setName("seed")
                .setDescription("Seed number for reproducible track (default: random)")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("format")
                .setDescription("Audio format (default: MP3 320kbps)")
                .setRequired(false)
                .addChoices(
                    { name: "🎧 MP3 (320kbps Studio Master)", value: "mp3" },
                    { name: "💎 FLAC (Lossless Master)", value: "flac" },
                ),
        ),
    new SlashCommandBuilder()
        .setName("step-music")
        .setDescription("🎵 StepAudio 3 — AI Full Studio Song Generator (StepFun Step-Music)")
        .addStringOption((o) =>
            o
                .setName("prompt")
                .setDescription("Song description, style, genre & instruments (e.g. 'summer acoustic pop with sweet vocals')")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("lyrics")
                .setDescription("Custom lyrics with structure tags ([verse], [chorus]). Leave blank for AI auto-writing.")
                .setRequired(false),
        )
        .addBooleanOption((o) =>
            o
                .setName("instrumental")
                .setDescription("Instrumental only (no vocals)?")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("format")
                .setDescription("Audio output format (default: MP3)")
                .setRequired(false)
                .addChoices(
                    { name: "🎵 MP3 (Compact / Streaming standard)", value: "mp3" },
                    { name: "💿 WAV (Lossless uncompressed studio)", value: "wav" },
                    { name: "🎧 FLAC (High-res lossless)", value: "flac" },
                    { name: "🌐 OPUS (Ultra low bitrate speech/music)", value: "opus" },
                ),
        )
        .addIntegerOption((o) =>
            o
                .setName("bitrate")
                .setDescription("Audio bitrate kbps for MP3/OPUS (default: 192kbps)")
                .setRequired(false)
                .addChoices(
                    { name: "192 kbps (Standard Studio)", value: 192 },
                    { name: "320 kbps (Ultra Audiophile High-Res)", value: 320 },
                ),
        )
        .addIntegerOption((o) =>
            o
                .setName("sample_rate")
                .setDescription("Audio sample rate in Hz (default: 44.1kHz)")
                .setRequired(false)
                .addChoices(
                    { name: "44.1 kHz (CD / Commercial Quality)", value: 44100 },
                    { name: "48.0 kHz (Studio Video / Broadcast)", value: 48000 },
                ),
        ),
    new SlashCommandBuilder()
        .setName("breeze")
        .setDescription("🎙️ Breeze TTS 2 — Voice Design | Voice Clone | Voice Direction (Bilingual EN/ZH)")
        .addStringOption((o) =>
            o
                .setName("text")
                .setDescription("Text to speak (supports vocal events: (laugh), (sigh), (cough), (clears throat))")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("mode")
                .setDescription("TTS Mode (default: Voice Design)")
                .setRequired(false)
                .addChoices(
                    { name: "🎨 Voice Design (describe a voice from text description)", value: "design" },
                    { name: "🧬 Voice Clone (clone from clean reference audio)", value: "clone" },
                    { name: "🎛️ Voice Direction (steer emotion, tone, pace & delivery)", value: "direction" },
                ),
        )
        .addStringOption((o) =>
            o
                .setName("instruction")
                .setDescription("Voice description (for Design) or tone/emotion direction (for Direction)")
                .setRequired(false),
        )
        .addAttachmentOption((o) =>
            o
                .setName("ref_audio")
                .setDescription("Reference audio file (.mp3/.wav) for Voice Clone or Voice Direction")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("ref_text")
                .setDescription("Exact reference transcript (optional — auto-transcribes with Whisper if omitted)")
                .setRequired(false),
        )
        .addNumberOption((o) =>
            o
                .setName("cfg_scale")
                .setDescription("CFG scale (default: 4.0, range: 1.0 - 10.0 — higher = stronger instruction adherence)")
                .setRequired(false)
                .setMinValue(1.0)
                .setMaxValue(10.0),
        )
        .addIntegerOption((o) =>
            o
                .setName("seed")
                .setDescription("Seed number for reproducible generation (default: 42)")
                .setRequired(false),
        ),
    new SlashCommandBuilder()
        .setName("triposplat")
        .setDescription("🧊 TripoSplat — Ultra-Fast 3D Gaussian Splatting Generator (Image to 3D Model)")
        .addAttachmentOption((o) =>
            o
                .setName("image")
                .setDescription("Source image to transform into a 3D Gaussian Splat model")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("quality")
                .setDescription("3D Gaussian point density (default: 262k - High Detail)")
                .setRequired(false)
                .addChoices(
                    { name: "⚡ Fast Preview (65,536 Gaussians)", value: "65536" },
                    { name: "⚖️ Balanced (131,072 Gaussians)", value: "131072" },
                    { name: "💎 High Detail (262,144 Gaussians)", value: "262144" },
                    { name: "🔥 Ultra-Dense 4K (524,288 Gaussians)", value: "524288" },
                ),
        )
        .addIntegerOption((o) =>
            o
                .setName("steps")
                .setDescription("Sampling steps (default: 20, range: 10-50)")
                .setRequired(false)
                .setMinValue(10)
                .setMaxValue(50),
        )
        .addNumberOption((o) =>
            o
                .setName("guidance")
                .setDescription("Guidance scale / image adherence (default: 3.0, range: 1.0 - 8.0)")
                .setRequired(false)
                .setMinValue(1.0)
                .setMaxValue(8.0),
        )
        .addStringOption((o) =>
            o
                .setName("format")
                .setDescription("3D output format (default: PLY standard 3D file)")
                .setRequired(false)
                .addChoices(
                    { name: "📦 PLY (Standard 3D Gaussian Splat / Point Cloud)", value: "ply" },
                    { name: "🌐 SPLAT (Compact WebGPU 3D Splatting File)", value: "splat" },
                ),
        )
        .addIntegerOption((o) =>
            o
                .setName("seed")
                .setDescription("Seed number for reproducible 3D generation (default: 42)")
                .setRequired(false),
        ),
    new SlashCommandBuilder()
        .setName("openvoice")
        .setDescription("🎙️ OpenVoice V2 — Instant AI Voice Cloning & Cross-Lingual Speech Synthesis")
        .addStringOption((o) =>
            o
                .setName("text")
                .setDescription("Text to synthesize in cloned voice")
                .setRequired(true),
        )
        .addAttachmentOption((o) =>
            o
                .setName("ref_audio")
                .setDescription("Reference voice audio file (.mp3/.wav) to clone")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("style")
                .setDescription("Voice accent & language style (default: English US)")
                .setRequired(false)
                .addChoices(
                    { name: "🇺🇸 English (US)", value: "en_us" },
                    { name: "🇮🇳 English (Indian)", value: "en_in" },
                    { name: "🇬🇧 English (Default)", value: "en_default" },
                    { name: "🇦🇺 English (Australian)", value: "en_au" },
                    { name: "🇪🇸 Spanish", value: "es_default" },
                    { name: "🇫🇷 French", value: "fr_default" },
                    { name: "🇯🇵 Japanese", value: "jp_default" },
                    { name: "🇨🇳 Chinese", value: "zh_default" },
                    { name: "🇰🇷 Korean", value: "kr_default" },
                ),
        ),
    new SlashCommandBuilder()
        .setName("wan-animate")
        .setDescription("🎬 Wan 2.2 Animate — Character Swap & Motion Retargeting Video Pipeline")
        .addAttachmentOption((o) =>
            o
                .setName("video")
                .setDescription("Driving video providing motion/dance/action (.mp4)")
                .setRequired(true),
        )
        .addAttachmentOption((o) =>
            o
                .setName("image")
                .setDescription("Target character / edited image frame to animate")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("mode")
                .setDescription("Animation mode (default: Character Swap)")
                .setRequired(false)
                .addChoices(
                    { name: "🎭 Character Swap (Replace subject with target character)", value: "Character Swap" },
                    { name: "🕺 Motion Retarget (Full pose & motion transfer)", value: "Motion Retarget" },
                ),
        )
        .addNumberOption((o) =>
            o
                .setName("duration")
                .setDescription("Video duration in seconds (default: 2.0s, range: 1-5s)")
                .setRequired(false)
                .setMinValue(1.0)
                .setMaxValue(5.0),
        )
        .addStringOption((o) =>
            o
                .setName("resolution")
                .setDescription("Output resolution (default: Low Res - Fast)")
                .setRequired(false)
                .addChoices(
                    { name: "⚡ Low Res (Fast Generation)", value: "Low Res" },
                    { name: "💎 High Res (Detailed)", value: "High Res" },
                ),
        ),
    new SlashCommandBuilder()
        .setName("viggle")
        .setDescription("🕺 Viggle Animate — Character Animation & Motion Dance Synthesis")
        .addAttachmentOption((o) =>
            o
                .setName("video")
                .setDescription("Motion reference video (.mp4)")
                .setRequired(true),
        )
        .addAttachmentOption((o) =>
            o
                .setName("character")
                .setDescription("Character image to animate (.png/.jpg)")
                .setRequired(true),
        )
        .addIntegerOption((o) =>
            o
                .setName("seed")
                .setDescription("Seed number (default: 42)")
                .setRequired(false),
        ),
    new SlashCommandBuilder()
        .setName("hq-video")
        .setDescription("🎥 HighQualityVideo — 4K Multi-Frame High-FPS Video Generation Engine")
        .addAttachmentOption((o) =>
            o
                .setName("image")
                .setDescription("Source image to animate into high-quality video")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("prompt")
                .setDescription("Motion prompt (e.g. 'cinematic slow-motion pan, glowing neon particles')")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("duration")
                .setDescription("Duration seconds (default: 3.5s)")
                .setRequired(false)
                .addChoices(
                    { name: "3.5s (Standard)", value: "3.5" },
                    { name: "5.0s (Extended)", value: "5.0" },
                ),
        )
        .addStringOption((o) =>
            o
                .setName("fps")
                .setDescription("Frame rate multiplier / smoothness (default: 16 fps)")
                .setRequired(false)
                .addChoices(
                    { name: "🎬 16 FPS (Cinematic Standard)", value: "16" },
                    { name: "⚡ 32 FPS (Smooth)", value: "32" },
                    { name: "🚀 64 FPS (Ultra Fluid)", value: "64" },
                    { name: "🔥 128 FPS (Hyper Real)", value: "128" },
                ),
        )
        .addBooleanOption((o) =>
            o
                .setName("upscale")
                .setDescription("Upscale output to 4K Ultra-HD? (default: true)")
                .setRequired(false),
        )
        .addIntegerOption((o) =>
            o
                .setName("seed")
                .setDescription("Seed number (default: random)")
                .setRequired(false),
        ),
    new SlashCommandBuilder()
        .setName("dream-video")
        .setDescription("🎬 Dream Wan 2.2 — High-Speed 14B AOTI Video Engine with Camera Control")
        .addAttachmentOption((o) =>
            o
                .setName("image")
                .setDescription("Initial frame image to animate")
                .setRequired(true),
        )
        .addStringOption((o) =>
            o
                .setName("prompt")
                .setDescription("Motion description (e.g. 'camera zoom in, hair blowing gently in wind')")
                .setRequired(false),
        )
        .addStringOption((o) =>
            o
                .setName("camera_motion")
                .setDescription("Camera path (default: Slow Push In)")
                .setRequired(false)
                .addChoices(
                    { name: "🔍 Slow Push In", value: "Slow Push In" },
                    { name: "🔄 Slow Pull Back", value: "Slow Pull Back" },
                    { name: "⬅️ Pan Left", value: "Pan Left" },
                    { name: "➡️ Pan Right", value: "Pan Right" },
                    { name: "🌐 Orbit", value: "Orbit" },
                    { name: "📹 Handheld", value: "Handheld" },
                    { name: "🛑 Static", value: "Static" },
                ),
        )
        .addStringOption((o) =>
            o
                .setName("motion_style")
                .setDescription("Motion style preset (default: Cinematic)")
                .setRequired(false)
                .addChoices(
                    { name: "🎬 Cinematic", value: "Cinematic" },
                    { name: "🌿 Natural", value: "Natural" },
                    { name: "⚡ Dynamic", value: "Dynamic" },
                    { name: "👤 Portrait", value: "Portrait" },
                    { name: "🎨 Anime", value: "Anime" },
                ),
        )
        .addStringOption((o) =>
            o
                .setName("duration")
                .setDescription("Duration seconds (default: 3.5s)")
                .setRequired(false)
                .addChoices(
                    { name: "3.5s (Fast Turbo)", value: "3.5" },
                    { name: "5.0s (Full Shot)", value: "5.0" },
                ),
        )
        .addStringOption((o) =>
            o
                .setName("aspect_ratio")
                .setDescription("Aspect ratio (default: Auto)")
                .setRequired(false)
                .addChoices(
                    { name: "Auto (Keep Source)", value: "Auto (keep source ratio)" },
                    { name: "16:9 Landscape", value: "Landscape 16:9" },
                    { name: "9:16 Portrait", value: "Portrait 9:16" },
                    { name: "1:1 Square", value: "Square 1:1" },
                ),
        )
        .addIntegerOption((o) =>
            o
                .setName("seed")
                .setDescription("Seed number (default: random)")
                .setRequired(false),
        ),
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(
    process.env.DISCORD_BOT_TOKEN,
);

// DATABASE
const DATA_FILE = "./vps_data.json";
const MAX_SESSIONS = MAX_PER_CLUSTER * WORKER_POOL.length;
let db = { liveMessageId: null, sessions: [], cooldowns: {} };

function loadDB() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            db = {
                liveMessageId: null,
                sessions: [],
                cooldowns: {},
                ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")),
            };
        } catch (e) {
            console.error("DB read error", e);
        }
    }
}

function saveDB() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function cleanExpiredSessions() {
    const now = Date.now();
    db.sessions.forEach((s) => {
        if (s.expiresAt <= now) db.cooldowns[s.userId] = now + COOLDOWN_MS;
    });
    db.sessions = db.sessions.filter((s) => s.expiresAt > now);
    Object.keys(db.cooldowns).forEach((uid) => {
        if (db.cooldowns[uid] <= now) delete db.cooldowns[uid];
    });
    saveDB();
}

function getUserSession(uid) {
    return db.sessions.find((s) => s.userId === uid && !s.isAi);
}
function getCooldown(uid) {
    return Math.max(0, (db.cooldowns[uid] || 0) - Date.now());
}

// BOT STATUS
function updateBotStatus() {
    const free = MAX_SESSIONS - db.sessions.length;
    client.user.setPresence({
        activities: [
            {
                name:
                    free > 0
                        ? `${free}/${MAX_SESSIONS} slots free | ${WORKER_POOL.length} clusters`
                        : "All slots full",
                type: ActivityType.Watching,
            },
        ],
        status: free > 0 ? "online" : "dnd",
    });
}

// LIVE EMBED
async function updateLiveMessage() {
    if (!LIVE_CHANNEL_ID || LIVE_CHANNEL_ID === "PUT_ID_HERE") return;
    cleanExpiredSessions();
    updateBotStatus();

    try {
        const channel = await client.channels.fetch(LIVE_CHANNEL_ID);
        if (!channel) return;

        const free = MAX_SESSIONS - db.sessions.length;

        // Build per-cluster breakdown
        let clusterLines = "";
        let counter = 0;
        for (const cluster of WORKER_POOL) {
            const clusterSessions = db.sessions.filter(s => (s.clusterId || 1) === cluster.id);
            const clusterLoad = clusterSessions.length;
            const statusIcon = clusterLoad === 0 ? "🟢" : clusterLoad >= MAX_PER_CLUSTER ? "🔴" : "🟡";
            clusterLines += `\n${statusIcon} **${cluster.name}** — \`${clusterLoad} / ${MAX_PER_CLUSTER}\``;
            if (clusterLoad === 0) {
                clusterLines += " *(Idle)*";
            } else {
                for (const s of clusterSessions) {
                    counter++;
                    const left = Math.max(0, Math.floor((s.expiresAt - Date.now()) / 60000));
                    if (s.isAi) {
                        clusterLines += `\n  ${counter}. ⚡ <@${s.userId}> — \`${s.os}\` *(AI)* — \`~${left}m\``;
                    } else {
                        const os = OS_MAP[s.os] || {};
                        clusterLines += `\n  ${counter}. ${os.icon || "💻"} <@${s.userId}> — \`${os.label || s.os}\` — \`${left}m\``;
                    }
                }
            }
        }

        const embed = new EmbedBuilder()
            .setTitle("🛰️ Xploit HUB — Live Cluster Status")
            .setDescription(clusterLines ? clusterLines.substring(0, 4090) : "✅ All clusters idle.")
            .setColor(free > 0 ? "#00FF00" : "#FF0000")
            .addFields(
                {
                    name: "📊 Total Load",
                    value: `\`${db.sessions.length} / ${MAX_SESSIONS}\``,
                    inline: true,
                },
                { name: "🟢 Free Slots", value: `\`${free}\``, inline: true },
                { name: "⚡ Clusters", value: `\`${WORKER_POOL.length}\``, inline: true }
            )
            .setFooter({ text: `Auto-updates every 30s | ${WORKER_POOL.length} cluster(s) active` })
            .setTimestamp();

        let msg = null;
        if (db.liveMessageId) {
            try {
                msg = await channel.messages.fetch(db.liveMessageId);
            } catch {
                db.liveMessageId = null;
            }
        }
        if (!msg) {
            try {
                const hist = await channel.messages.fetch({ limit: 10 });
                msg = hist.find((m) => m.author.id === client.user.id);
                if (msg) {
                    db.liveMessageId = msg.id;
                    saveDB();
                }
            } catch {}
        }

        if (msg) {
            await msg.edit({ embeds: [embed] });
        } else {
            const nm = await channel.send({ embeds: [embed] });
            db.liveMessageId = nm.id;
            saveDB();
        }
    } catch (err) {
        console.error("❌ Live Tracker Update Failed:", err);
    }
}

// READY
client.on("ready", async () => {
    console.log(`Xploit HUB Bot online as ${client.user.tag}`);
    loadDB();
    try {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, XPLOIT_HUB_ID),
            { body: commands },
        );
        console.log("Commands registered.");
    } catch (e) {
        console.error("Command registration error:", e);
    }
    updateBotStatus();
    setInterval(updateLiveMessage, 30000);
    updateLiveMessage();
});

// INTERACTIONS
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    // AI Lab Dedicated Channel Enforcement (Admins exempt)
    if (AI_COMMAND_CHANNELS[commandName]) {
        const allowedChannel = AI_COMMAND_CHANNELS[commandName];
        if (interaction.channelId !== allowedChannel && !SUPER_ADMINS.has(interaction.user.id)) {
            return interaction.reply({
                content: `🚫 **Galat Channel! / Wrong Channel!**\nThe \`/${commandName}\` command can only be used in <#${allowedChannel}>.\nPlease run your prompt in <#${allowedChannel}>!`,
                ephemeral: true,
            });
        }
    }

    // AI Lab Cooldown Enforcement (1:30 min for users, Admin exempt)
    if (AI_LAB_COMMANDS.has(commandName)) {
        const uid = interaction.user.id;
        const isSuper = SUPER_ADMINS.has(uid);
        const now = Date.now();
        if (!isSuper) {
            const expiresAt = aiLabCooldowns.get(uid) || 0;
            if (expiresAt > now) {
                const remainingSec = Math.ceil((expiresAt - now) / 1000);
                const minutes = Math.floor(remainingSec / 60);
                const seconds = remainingSec % 60;
                const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
                return interaction.reply({
                    content: `⏳ **Cooldown Active:** Please wait \`${timeStr}\` before generating another AI media!\n*(1:30 minute cooldown between generations — Admin has no cooldown)*`,
                    ephemeral: true,
                });
            }
            aiLabCooldowns.set(uid, now + AI_LAB_COOLDOWN_MS);
        }
        
        // Pre-select worker for this AI dispatch
        const _aiWorker = getNextWorker();
        octokit._nextWorker = _aiWorker;
        
        // Track AI Session for GitHub Actions Capacity
        db.sessions.push({
            userId: uid,
            userName: interaction.user.username,
            os: commandName,
            isAi: true,
            clusterId: _aiWorker.id,
            clusterName: _aiWorker.name,
            startedAt: now,
            expiresAt: now + (3 * 60000),
        });
        saveDB();
        updateLiveMessage();
    }

    // /vps-status
    if (commandName === "vps-status") {
        cleanExpiredSessions();
        const uid = interaction.user.id;
        const isSuper = SUPER_ADMINS.has(uid);

        if (isSuper) {
            const mySessions = db.sessions.filter((s) => s.userId === uid);
            if (!mySessions.length) {
                return interaction.reply({
                    content: `👑 **[Admin]** No active sessions. You can launch multiple at once!`,
                    ephemeral: true,
                });
            }
            const lines = mySessions.map((s, i) => {
                const left = Math.max(0, Math.floor((s.expiresAt - Date.now()) / 60000));
                if (s.isAi) return `**${i + 1}.** ⚡ \`${s.os}\` (AI Render) — \`~${left} min left\``;
                const os = OS_MAP[s.os] || {};
                return `**${i + 1}.** ${os.icon || "💻"} \`${os.label || s.os}\` — \`${left} min left\``;
            }).join("\n");
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("👑 Your Active Sessions (Admin)")
                        .setColor("#FFD700")
                        .setDescription(lines)
                        .setFooter({ text: `${mySessions.length} session(s) running — no limits, no cooldown.` }),
                ],
                ephemeral: true,
            });
        }

        const session = getUserSession(uid);
        const aiSession = db.sessions.find(s => s.userId === uid && s.isAi);
        const cd = getCooldown(uid);
        
        if (session || aiSession) {
            const embed = new EmbedBuilder()
                .setTitle("💻 Your Active Sessions")
                .setColor("#00BFFF")
                .setFooter({ text: "Machines self-destruct when timer hits zero." });
                
            if (session) {
                const left = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 60000));
                const os = OS_MAP[session.os] || {};
                embed.addFields({
                    name: `🖥️ VPS / VPN`,
                    value: `${os.icon || ""} ${os.label || session.os} — \`${left} min left\``,
                    inline: false,
                });
            }
            if (aiSession) {
                const left = Math.max(0, Math.floor((aiSession.expiresAt - Date.now()) / 60000));
                embed.addFields({
                    name: `🧠 AI Render Task`,
                    value: `⚡ ${aiSession.os} — \`~${left} min left\``,
                    inline: false,
                });
            }
            return interaction.reply({ embeds: [embed], ephemeral: true });
        } else if (cd > 0) {
            return interaction.reply({
                content: `⏳ **Cooldown:** Wait \`${Math.ceil(cd / 60000)} minutes\` before claiming another VPS.`,
                ephemeral: true,
            });
        } else {
            return interaction.reply({
                content: `✅ No active session. Head to <#${VPS_CHANNEL_ID}> to launch one.`,
                ephemeral: true,
            });
        }
    }

    // /vps-admin
    if (commandName === "vps-admin") {
        if (
            !interaction.memberPermissions?.has(
                PermissionFlagsBits.Administrator,
            )
        )
            return interaction.reply({
                content: "❌ Admins only.",
                ephemeral: true,
            });

        cleanExpiredSessions();
        const sub = interaction.options.getSubcommand();

        if (sub === "list") {
            if (!db.sessions.length)
                return interaction.reply({
                    content: "✅ No active sessions.",
                    ephemeral: true,
                });
            const lines = db.sessions
                .map((s, i) => {
                    const left = Math.max(
                        0,
                        Math.floor((s.expiresAt - Date.now()) / 60000),
                    );
                    const os = OS_MAP[s.os] || {};
                    return `**${i + 1}.** ${os.icon || "💻"} <@${s.userId}> (\`${s.userName}\`) — \`${os.label || s.os}\` — \`${left} min left\``;
                })
                .join("\n");
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("📋 Active Sessions")
                        .setDescription(lines)
                        .setColor("#FFA500"),
                ],
                ephemeral: true,
            });
        }

        if (sub === "kick") {
            const target = interaction.options.getUser("user");
            const before = db.sessions.length;
            db.sessions = db.sessions.filter((s) => s.userId !== target.id);
            saveDB();
            updateLiveMessage();
            return interaction.reply({
                content:
                    db.sessions.length < before
                        ? `✅ Kicked **${target.username}** from their session.`
                        : `⚠️ **${target.username}** had no active session.`,
                ephemeral: true,
            });
        }

        if (sub === "clear") {
            db.sessions = [];
            saveDB();
            updateLiveMessage();
            return interaction.reply({
                content: "🗑️ All sessions cleared.",
                ephemeral: true,
            });
        }

        if (sub === "announce") {
            const msg = interaction.options.getString("message");
            if (!db.sessions.length)
                return interaction.reply({ content: "⚠️ No active sessions to announce to.", ephemeral: true });

            await interaction.deferReply({ ephemeral: true });
            let sent = 0;
            for (const s of db.sessions) {
                try {
                    const u = await client.users.fetch(s.userId);
                    await u.send(
                        `📢 **Xploit HUB Announcement**\n${msg}\n\n*From: Server Admin*`
                    );
                    sent++;
                } catch {}
            }
            return interaction.editReply({ content: `✅ Announcement sent to **${sent}** active VPS users.` });
        }
    }

    // /ping
    if (commandName === "ping") {
        const ws = client.ws.ping;
        const uptime = process.uptime();
        const h = Math.floor(uptime / 3600);
        const m = Math.floor((uptime % 3600) / 60);
        const s = Math.floor(uptime % 60);
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle("🏓 Xploit HUB — Bot Status")
                    .setColor("#00FF41")
                    .addFields(
                        { name: "📡 WebSocket Latency", value: `\`${ws}ms\``,                               inline: true },
                        { name: "⏱️ Uptime",             value: `\`${h}h ${m}m ${s}s\``,                    inline: true },
                        { name: "💻 Active Sessions",    value: `\`${db.sessions.length} / ${MAX_SESSIONS}\``, inline: true },
                        { name: "🛰️ Status",             value: `\`Online & Operational\``,                  inline: true },
                    )
                    .setFooter({ text: "Xploit HUB VPS System" })
                    .setTimestamp(),
            ],
            ephemeral: true,
        });
    }

    // /zimage
    if (commandName === "zimage") {
        const prompt = interaction.options.getString("prompt");
        const ratio = interaction.options.getString("ratio") || "1:1";
        const steps = interaction.options.getInteger("steps") || 8;
        const seed = interaction.options.getInteger("seed");

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "zimage",
                    prompt: prompt,
                    image_url: ratio,
                    steps: String(steps),
                    duration: "",
                    seed: seed !== null && seed !== undefined ? String(seed) : "-1",
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const embed = new EmbedBuilder()
                .setTitle("⚡ Xploit AI Lab — Z-Image-Turbo (Unrestricted)")
                .setColor("#FF0055")
                .setDescription("Dispatching to **S3-DiT Single-Stream Diffusion Transformer Engine** with **Zero Censorship / No Filters**!")
                .addFields(
                    { name: "📝 Prompt", value: `\`${prompt}\``, inline: false },
                    { name: "📐 Aspect Ratio", value: `\`${ratio}\``, inline: true },
                    { name: "⚡ Inference Steps", value: `\`${steps} NFEs\``, inline: true },
                    { name: "🎲 Seed", value: seed !== null && seed !== undefined ? `\`${seed}\`` : "`Randomized`", inline: true },
                    { name: "🧠 Model Architecture", value: "`Tongyi-MAI Z-Image-Turbo`", inline: true },
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~2 Minutes`", inline: true },
                )
                .setFooter({ text: "⚡ Running on Localhost Dedicated Node (70GB Cluster) • Please wait ~2 minutes. Dropping in this channel." })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("Z-Image error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /qwen-edit
    if (commandName === "qwen-edit") {
        const prompt = interaction.options.getString("prompt");
        const attachment = interaction.options.getAttachment("image");
        const fluxUpscale = interaction.options.getBoolean("flux_upscale") || false;
        const quality = interaction.options.getString("quality") || "fast";
        const style = interaction.options.getString("style") || "Ultrarealistic-Portrait";
        const steps = interaction.options.getInteger("steps") || 6;
        const seed = interaction.options.getInteger("seed");

        if (!attachment || !attachment.url) {
            return interaction.reply({ content: "❌ Please provide a valid source image.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "qwen-edit",
                    prompt: prompt,
                    image_url: attachment.url,
                    steps: String(steps),
                    style: `${quality}__${style}`,
                    duration: fluxUpscale ? "flux_upscale" : "",
                    seed: seed !== null && seed !== undefined ? String(seed) : "-1",
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const embed = new EmbedBuilder()
                .setTitle("🧠 Xploit AI Lab — Qwen-Image-Edit-2511 (Unrestricted)")
                .setColor("#8A2BE2")
                .setDescription("Dispatching to **Qwen 20B Inpainting & Instruction Editing Engine** with **Character Consistency Protection**!")
                .addFields(
                    { name: "🎯 Instruction", value: `\`${prompt}\``, inline: false },
                    { name: "🖼️ Source Image", value: `[View Original](${attachment.url})`, inline: true },
                    { name: "🧠 Model Architecture", value: "`Qwen-Image-Edit-2511 (20B)`", inline: true },
                    { name: "⚡ FLUX.2 Klein 4K", value: fluxUpscale ? "`Auto-Chain 4K UltraSharp`" : "`Disabled`", inline: true },
                    { name: "🔧 Quality Mode", value: quality === "ultra" ? "`Ultra — Max Res & Steps`" : "`Fast — ZeroGPU Safe`", inline: true },
                    { name: "🎲 Seed", value: seed !== null && seed !== undefined ? `\`${seed}\`` : "`Random / Auto`", inline: true },
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~2 Minutes`", inline: true },
                )
                .setThumbnail(attachment.url)
                .setFooter({ text: "⚡ Running on Localhost Dedicated Node (70GB Cluster) • Please wait ~2 minutes. Dropping in this channel." })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("Qwen-Edit error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /qwen21-unrestricted
    if (commandName === "qwen21-unrestricted") {
        const prompt = interaction.options.getString("prompt");
        const mode = interaction.options.getString("mode") || "Create an image";
        const reference = interaction.options.getAttachment("reference");
        const ratio = interaction.options.getString("ratio") || "Square · 1:1 (1024x1024)";
        const steps = interaction.options.getInteger("steps") || 40;
        const seed = interaction.options.getInteger("seed");
        const randomizeSeed = interaction.options.getBoolean("randomize_seed") ?? true;

        // Edit mode & Transparent PNG require reference image
        if ((mode === "Edit an image" || mode === "Transparent PNG") && (!reference || !reference.url)) {
            return interaction.reply({ 
                content: `❌ **${mode}** requires a reference image! Please attach an image.`, 
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "qwen21-unrestricted",
                    prompt: prompt,
                    image_url: reference ? reference.url : "",
                    steps: String(steps),
                    style: mode,
                    duration: ratio,
                    seed: seed !== null && seed !== undefined ? String(seed) : (randomizeSeed ? "-1" : "42"),
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const embed = new EmbedBuilder()
                .setTitle("🔥 Xploit AI Lab — Qwen-Image-2.1 Uncensored GGUF Studio")
                .setColor("#FF6B35")
                .setDescription("Dispatching to **Qwen-Image-2.1 GGUF Unrestricted Engine** with **Multi-Mode Support & Zero Censorship**!")
                .addFields(
                    { name: "📝 Prompt", value: `\`${prompt}\``, inline: false },
                    { name: "🎨 Mode", value: `\`${mode}\``, inline: true },
                    { name: "📐 Aspect Ratio", value: `\`${ratio}\``, inline: true },
                    { name: "⚡ Inference Steps", value: `\`${steps} Steps\``, inline: true },
                    { name: "🎲 Seed", value: seed !== null && seed !== undefined ? `\`${seed}\`` : (randomizeSeed ? "`Randomized`" : "`42 (Default)`"), inline: true },
                    { name: "🧠 Model Architecture", value: "`Qwen-Image-2.1-Uncensored-GGUF (7B)`", inline: true },
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~2 Minutes`", inline: true },
                )
                .setFooter({ text: "⚡ Running on Localhost Dedicated Node (70GB Cluster) • Zero Restrictions • Dropping in this channel." })
                .setTimestamp();

            if (reference && reference.url) {
                embed.setThumbnail(reference.url);
                embed.addFields({ name: "🖼️ Reference Image", value: `[View Original](${reference.url})`, inline: false });
            }

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("Qwen21-Unrestricted error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /flux-klein (FLUX.2 Klein Multi-LoRA 4K Studio)
    if (commandName === "flux-klein") {
        const prompt = interaction.options.getString("prompt");
        const attachment = interaction.options.getAttachment("image");
        const upscaleFactor = interaction.options.getString("upscale_factor") || "4× — UltraSharp (crisp)";
        const style = interaction.options.getString("style") || "upscaler_hi_res";
        const steps = interaction.options.getInteger("steps") || 4;
        const seed = interaction.options.getInteger("seed");

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "flux-klein",
                    prompt: prompt,
                    image_url: attachment ? attachment.url : "",
                    steps: String(steps),
                    style: style,
                    duration: upscaleFactor,
                    seed: seed !== null && seed !== undefined ? String(seed) : "-1",
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const embed = new EmbedBuilder()
                .setTitle("⚡ Xploit AI Lab — FLUX.2 Klein Multi-LoRA 4K Studio")
                .setDescription("Dispatching to **FLUX.2 Klein Multi-LoRA Studio** with high-resolution depth and super-resolution upscaler!")
                .addFields(
                    { name: "📝 Prompt", value: `\`${prompt}\``, inline: false },
                    { name: "🔍 Upscaler", value: `\`${upscaleFactor}\``, inline: true },
                    { name: "🧬 Style LoRA", value: `\`${style}\``, inline: true },
                    { name: "⚡ Steps", value: `\`${steps}\``, inline: true },
                    { name: "🎲 Seed", value: seed !== null && seed !== undefined ? `\`${seed}\`` : "`Random / Auto`", inline: true },
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~2 Minutes`", inline: true },
                )
                .setColor(0x00ffcc)
                .setFooter({ text: "⚡ Running on Localhost Dedicated Node (70GB Cluster) • Please wait ~2 minutes. Dropping in this channel." })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("FLUX-Klein error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /wan-video
    if (commandName === "wan-video") {
        const attachment = interaction.options.getAttachment("image");
        const prompt = interaction.options.getString("prompt") || "make this image come alive, cinematic motion, smooth animation, 4k ultra realistic";
        const duration = interaction.options.getString("duration") || "3.5";
        const steps = interaction.options.getInteger("steps") || 6;
        const seed = interaction.options.getInteger("seed");

        if (!attachment || !attachment.url) {
            return interaction.reply({ content: "❌ Please attach a source image to animate.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "wan-video",
                    prompt: prompt,
                    image_url: attachment.url,
                    steps: String(steps),
                    duration: duration,
                    seed: seed !== null && seed !== undefined ? String(seed) : "-1",
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const embed = new EmbedBuilder()
                .setTitle("🎬 Xploit AI Lab — Wan 2.2 I2V 14B Video Engine")
                .setColor("#FF4500")
                .setDescription("Dispatching to **Wan 2.2 14B Image-to-Video Cloud Cluster** with **Custom LoRA Support**!")
                .addFields(
                    { name: "🎥 Motion Prompt", value: `\`${prompt}\``, inline: false },
                    { name: "🖼️ Base Frame", value: `[View Original](${attachment.url})`, inline: true },
                    { name: "⏱️ Duration", value: `\`${duration} Seconds\``, inline: true },
                    { name: "⚡ Steps", value: `\`${steps} Steps\``, inline: true },
                    { name: "🎲 Seed", value: seed !== null && seed !== undefined ? `\`${seed}\`` : "`Randomized`", inline: true },
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~2 Minutes`", inline: true },
                )
                .setThumbnail(attachment.url)
                .setFooter({ text: "⚡ Running on Localhost Dedicated Node (70GB Cluster) • Please wait ~2 minutes. Dropping in this channel." })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("Wan-Video error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /pixel-perfect
    if (commandName === "pixel-perfect") {
        const inputImage = interaction.options.getAttachment("input_image");
        const lastImage = interaction.options.getAttachment("last_image");
        const prompt = interaction.options.getString("prompt") || "cinematic camera motion, smooth transitions, ultra high definition 4k quality";
        const duration = interaction.options.getString("duration") || "3.5";
        const steps = interaction.options.getInteger("steps") || 6;
        const guidanceScale = interaction.options.getNumber("guidance_scale") || 2.5;
        const seed = interaction.options.getInteger("seed");
        const quality = interaction.options.getString("quality") || "normal";
        const scheduler = interaction.options.getString("scheduler") || "euler";
        const frameMultiplier = interaction.options.getString("frame_multiplier") || "32";
        const safeMode = interaction.options.getBoolean("safe_mode") ?? false;
        const loraPreset1 = interaction.options.getString("lora_preset_1") || "none";
        const loraPreset2 = interaction.options.getString("lora_preset_2") || "none";
        const loraPreset3 = interaction.options.getString("lora_preset_3") || "none";
        const customLora1 = interaction.options.getString("custom_lora_1") || "";
        const customLora1Weight = interaction.options.getNumber("custom_lora_1_weight") || 1.0;
        const customLora2 = interaction.options.getString("custom_lora_2") || "";
        const customLora2Weight = interaction.options.getNumber("custom_lora_2_weight") || 1.0;

        if (!inputImage || !inputImage.url) {
            return interaction.reply({ content: "❌ Please attach a primary input image to animate.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "pixel-perfect",
                    prompt: prompt,
                    image_url: inputImage.url,
                    last_image_url: lastImage?.url || "",
                    steps: String(steps),
                    duration: duration,
                    guidance_scale: String(guidanceScale),
                    seed: seed !== null && seed !== undefined ? String(seed) : "-1",
                    quality: quality,
                    scheduler: scheduler,
                    frame_multiplier: frameMultiplier,
                    safe_mode: String(safeMode),
                    lora_preset_1: loraPreset1,
                    lora_preset_2: loraPreset2,
                    lora_preset_3: loraPreset3,
                    custom_lora_1: customLora1,
                    custom_lora_1_weight: String(customLora1Weight),
                    custom_lora_2: customLora2,
                    custom_lora_2_weight: String(customLora2Weight),
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const loraInfo = [];
            if (loraPreset1 !== "none") loraInfo.push(`Preset 1: ${loraPreset1}`);
            if (loraPreset2 !== "none") loraInfo.push(`Preset 2: ${loraPreset2}`);
            if (loraPreset3 !== "none") loraInfo.push(`Preset 3: ${loraPreset3}`);
            if (customLora1) loraInfo.push(`Custom 1 (${customLora1Weight}x)`);
            if (customLora2) loraInfo.push(`Custom 2 (${customLora2Weight}x)`);
            const loraDisplay = loraInfo.length > 0 ? loraInfo.join(" | ") : "None";

            const embed = new EmbedBuilder()
                .setTitle("🎥 Xploit AI Lab — Perfect Pixel Engine 1.0")
                .setColor("#9B59B6")
                .setDescription("Dispatching to **Perfect Pixel Engine 1.0** — Premium Custom LoRA I2V 14B with **13-Second Max Studio Quality**!")
                .addFields(
                    { name: "🎬 Motion Prompt", value: `\`${prompt}\``, inline: false },
                    { name: "🖼️ Input Frame", value: `[View Original](${inputImage.url})`, inline: true },
                    { name: "🎞️ Last Frame", value: lastImage ? `[View](${lastImage.url})` : "`Not Provided`", inline: true },
                    { name: "⏱️ Duration", value: `\`${duration} Seconds\` (Max 13s)`, inline: true },
                    { name: "⚡ Steps", value: `\`${steps} Steps\``, inline: true },
                    { name: "🎯 Guidance", value: `\`${guidanceScale}\``, inline: true },
                    { name: "🎲 Seed", value: seed !== null && seed !== undefined ? `\`${seed}\`` : "`Randomized`", inline: true },
                    { name: "🎨 Quality", value: `\`${quality}\``, inline: true },
                    { name: "📊 Frame Multiplier", value: `\`${frameMultiplier}\``, inline: true },
                    { name: "🔧 Scheduler", value: `\`${scheduler}\``, inline: true },
                    { name: "🎭 LoRA Stack", value: `\`${loraDisplay}\``, inline: false },
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~3-5 Minutes`", inline: true },
                )
                .setThumbnail(inputImage.url)
                .setFooter({ text: "⚡ Running on Localhost Dedicated Node (70GB Cluster) • Please wait ~3-5 minutes. Dropping in this channel." })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("Pixel-Perfect error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /krea
    if (commandName === "krea") {
        const prompt = interaction.options.getString("prompt");
        const ratio = interaction.options.getString("ratio") || "1:1";
        const steps = interaction.options.getInteger("steps") || 8;
        const seed = interaction.options.getInteger("seed");

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "krea-2",
                    prompt: prompt,
                    image_url: ratio,
                    steps: String(steps),
                    duration: "",
                    seed: seed !== null && seed !== undefined ? String(seed) : "-1",
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const embed = new EmbedBuilder()
                .setTitle("🔞 Xploit AI Lab — Krea-2-Turbo Ultra-Photorealism")
                .setColor("#00FFFF")
                .setDescription("Dispatching to **Krea-2-Turbo Multi-LoRA Engine** with **Refusal-Reduction & 8K DSLR Tuning**!")
                .addFields(
                    { name: "📝 Prompt", value: `\`${prompt}\``, inline: false },
                    { name: "📐 Aspect Ratio", value: `\`${ratio}\``, inline: true },
                    { name: "⚡ Inference Steps", value: `\`${steps} Steps\``, inline: true },
                    { name: "🎲 Seed", value: seed !== null && seed !== undefined ? `\`${seed}\`` : "`Randomized`", inline: true },
                    { name: "🧬 Base Checkpoint", value: "`Krea2-v2Turbo Int8`", inline: true },
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~2 Minutes`", inline: true },
                )
                .setFooter({ text: "⚡ Running on Localhost Dedicated Node (70GB Cluster) • Please wait ~2 minutes. Dropping in this channel." })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("Krea error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /minimax
    if (commandName === "minimax") {
        const prompt = interaction.options.getString("prompt");
        const duration = interaction.options.getString("duration") || "3.5";
        const steps = interaction.options.getInteger("steps") || 4;
        const seed = interaction.options.getInteger("seed");

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "minimax-h3",
                    prompt: prompt,
                    image_url: "",
                    steps: String(steps),
                    duration: duration,
                    seed: seed !== null && seed !== undefined ? String(seed) : "-1",
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const embed = new EmbedBuilder()
                .setTitle("🎬 Xploit AI Lab — MiniMax-H3 Uncensored Video+Audio")
                .setColor("#FF1493")
                .setDescription("Dispatching to **MiniMax-H3 (Hailuo 3) Turbo LoRA T2VA Cluster** with **Synced Audio Generation**!")
                .addFields(
                    { name: "🎥 Scene Prompt", value: `\`${prompt}\``, inline: false },
                    { name: "⏱️ Duration", value: `\`${duration} Seconds\``, inline: true },
                    { name: "⚡ Turbo Steps", value: `\`${steps} Steps (LoRA)\``, inline: true },
                    { name: "🎲 Seed", value: seed !== null && seed !== undefined ? `\`${seed}\`` : "`Randomized`", inline: true },
                    { name: "🔊 Soundtrack", value: "`Auto-Synchronized SFX`", inline: true },
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~2 Minutes`", inline: true },
                )
                .setFooter({ text: "⚡ Running on Localhost Dedicated Node (70GB Cluster) • Please wait ~2 minutes. Dropping in this channel." })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("MiniMax error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /kokoro
    if (commandName === "kokoro") {
        const text = interaction.options.getString("text");
        const voice = interaction.options.getString("voice") || "af_heart";

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "kokoro-tts",
                    prompt: text,
                    image_url: voice,
                    steps: "1",
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const embed = new EmbedBuilder()
                .setTitle("🎙️ Xploit AI Lab — Kokoro-TTS Hyper-Realistic Voice")
                .setColor("#32CD32")
                .setDescription("Dispatching to **Kokoro-TTS Zero-Shot Neural Voice Engine**!")
                .addFields(
                    { name: "🗣️ Text", value: `\`${text}\``, inline: false },
                    { name: "🎭 Voice Preset", value: `\`${voice}\``, inline: true },
                    { name: "⚡ Quality", value: "`24kHz Studio Quality`", inline: true },
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~2 Minutes`", inline: true },
                )
                .setFooter({ text: "⚡ Running on Localhost Dedicated Node (70GB Cluster) • Please wait ~2 minutes. Dropping in this channel." })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("Kokoro error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /qwen-voice
    if (commandName === "qwen-voice") {
        const text = interaction.options.getString("text");
        const mode = interaction.options.getString("mode") || "preset";
        const speaker = interaction.options.getString("speaker") || "Vivian";
        const refAudio = interaction.options.getAttachment("ref_audio");
        const refText = interaction.options.getString("ref_text") || "";
        const voiceDescription = interaction.options.getString("voice_description") || "";
        const instruct = interaction.options.getString("instruct") || "Natural, expressive, clear studio quality voice.";
        const language = interaction.options.getString("language") || "Auto";
        const modelSize = interaction.options.getString("model_size") || "1.7B";

        // Clone mode needs a ref audio
        if (mode === "clone" && (!refAudio || !refAudio.url)) {
            return interaction.reply({ content: "❌ **Clone mode** requires a `ref_audio` attachment (.mp3 or .wav)!", ephemeral: true });
        }
        // Design mode needs a description
        if (mode === "design" && !voiceDescription) {
            return interaction.reply({ content: "❌ **Design mode** requires a `voice_description` (e.g. 'deep, calm male narrator')!", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "qwen-voice",
                    prompt: text,
                    // Pack all extra params into image_url as JSON string
                    image_url: JSON.stringify({
                        mode,
                        speaker,
                        ref_audio_url: refAudio ? refAudio.url : "",
                        ref_text: refText,
                        voice_description: voiceDescription,
                        instruct,
                        language,
                        model_size: modelSize,
                    }),
                    steps: "1",
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const modeLabel = mode === "clone" ? "🧬 Voice Clone" : mode === "design" ? "🎨 Voice Design" : "🎭 Preset Speaker";
            const embed = new EmbedBuilder()
                .setTitle("🎙️ Xploit AI Lab — Qwen3-TTS Neural Studio")
                .setColor("#8A2BE2")
                .setDescription(`Synthesizing speech via **Qwen3-TTS ${modelSize} Neural Engine** — **${modeLabel}** mode!`)
                .addFields(
                    { name: "🗣️ Text", value: `\`${text.slice(0, 200)}\``, inline: false },
                    { name: "⚙️ Mode", value: `\`${modeLabel}\``, inline: true },
                    { name: "🌐 Language", value: `\`${language}\``, inline: true },
                    { name: "🔬 Model", value: `\`Qwen3-TTS ${modelSize}\``, inline: true },
                    ...(mode === "preset" ? [{ name: "🎭 Speaker", value: `\`${speaker}\``, inline: true }] : []),
                    ...(mode === "preset" && instruct ? [{ name: "🎬 Instruct", value: `\`${instruct}\``, inline: false }] : []),
                    ...(mode === "clone" ? [{ name: "🎤 Ref Audio", value: `[Listen](${refAudio.url})`, inline: true }] : []),
                    ...(mode === "clone" && refText ? [{ name: "📝 Ref Transcript", value: `\`${refText.slice(0, 100)}\``, inline: false }] : []),
                    ...(mode === "design" ? [{ name: "🎨 Voice Description", value: `\`${voiceDescription}\``, inline: false }] : []),
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~2 Minutes`", inline: true },
                )
                .setFooter({ text: "⚡ Running on Localhost Dedicated Node (70GB Cluster) • Please wait ~2 minutes. Dropping in this channel." })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("Qwen Voice error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }
    // /music
    if (commandName === "music") {
        const prompt = interaction.options.getString("prompt");
        const engine = interaction.options.getString("engine") || "minimax";
        const lyrics = interaction.options.getString("lyrics") || "";
        const duration = interaction.options.getString("duration") || "60";
        const instrumental = interaction.options.getBoolean("instrumental") || false;
        const seed = interaction.options.getInteger("seed");

        await interaction.deferReply({ ephemeral: false });

        try {
            if (engine === "yue") {
                await octokit.actions.createWorkflowDispatch({
                    owner: REPO_OWNER,
                    repo: REPO_NAME,
                    workflow_id: "ai-lab.yml",
                    ref: "main",
                    inputs: {
                        action_type: "yue-music",
                        prompt: prompt,
                        image_url: lyrics || (instrumental ? "[instrumental]" : ""),
                        steps: "full",
                        duration: "16",
                        seed: seed !== null && seed !== undefined ? String(seed) : "-1",
                        style: "mp3",
                        user_id: interaction.user.id,
                        channel_id: interaction.channelId,
                    },
                });

                const embed = new EmbedBuilder()
                    .setTitle("🎵 Xploit AI Lab — YuE 2 (3B) Music")
                    .setColor("#9370DB")
                    .setDescription("Composing full studio track via **YuE 2 (3B) Neural Music Pipeline**!")
                    .addFields(
                        { name: "🎼 Style / Prompt", value: `\`${prompt.length > 150 ? prompt.slice(0, 147) + "..." : prompt}\``, inline: false },
                        { name: "📝 Lyrics", value: lyrics ? `\`${lyrics.length > 100 ? lyrics.slice(0, 97) + "..." : lyrics}\`` : (instrumental ? "`Instrumental Only`" : "`Auto / Vocal Mode`"), inline: false },
                        { name: "🧠 Mode", value: "`Full CoT Reasoning`", inline: true },
                        { name: "🎲 Seed", value: seed !== null && seed !== undefined ? `\`${seed}\`` : "`Randomized`", inline: true },
                        { name: "⚡ Quality", value: "`320kbps Studio Master`", inline: true },
                        { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                        { name: "⏳ Est. Render", value: "`~2 Minutes`", inline: true },
                    )
                    .setFooter({ text: "⚡ Running on Localhost Dedicated Node (70GB Cluster) • Please wait ~2 minutes. Dropping in this channel." })
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }

            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "minimax-music",
                    prompt: prompt,
                    image_url: instrumental ? "true" : "false",
                    steps: "30",
                    duration: duration,
                    seed: seed !== null && seed !== undefined ? String(seed) : "-1",
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const embed = new EmbedBuilder()
                .setTitle("🎵 Xploit AI Lab — MiniMax Music 3")
                .setColor("#FF1493")
                .setDescription("Composing full song via **MiniMax Music 3 Neural Model**!")
                .addFields(
                    { name: "🎼 Description / Style", value: `\`${prompt}\``, inline: false },
                    { name: "⏱️ Duration", value: `\`${duration} Seconds\``, inline: true },
                    { name: "🎤 Mode", value: instrumental ? "`Instrumental Only`" : "`Full Vocals + Lyrics`", inline: true },
                    { name: "🎲 Seed", value: seed !== null && seed !== undefined ? `\`${seed}\`` : "`Randomized`", inline: true },
                    { name: "⚡ Quality", value: "`44.1kHz Studio Master`", inline: true },
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~2 Minutes`", inline: true },
                )
                .setFooter({ text: "⚡ Running on Localhost Dedicated Node (70GB Cluster) • Please wait ~2 minutes. Dropping in this channel." })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("Music error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /yue
    if (commandName === "yue") {
        const prompt = interaction.options.getString("prompt");
        const lyrics = interaction.options.getString("lyrics") || "";
        const cot = interaction.options.getString("cot") || "full";
        const quality = interaction.options.getString("quality") || "16";
        const seed = interaction.options.getInteger("seed");
        const format = interaction.options.getString("format") || "mp3";

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "yue-music",
                    prompt: prompt,
                    image_url: lyrics,
                    steps: cot,
                    duration: quality,
                    seed: seed !== null && seed !== undefined ? String(seed) : "-1",
                    style: format,
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const embed = new EmbedBuilder()
                .setTitle("🎵 Xploit AI Lab — YuE 2 (3B) Neural Music")
                .setColor("#9370DB")
                .setDescription("Composing full studio track with **YuE 2 (3B) Neural Music Pipeline**!")
                .addFields(
                    { name: "🎼 Style / Prompt", value: `\`${prompt.length > 150 ? prompt.slice(0, 147) + "..." : prompt}\``, inline: false },
                    { name: "📝 Lyrics", value: lyrics ? `\`${lyrics.length > 100 ? lyrics.slice(0, 97) + "..." : lyrics}\`` : "`Auto-Composed / Vocal Mode`", inline: false },
                    { name: "🧠 Planning Mode", value: `\`${cot.toUpperCase()}\``, inline: true },
                    { name: "⚡ Render Quality", value: quality === "32" ? "`32 Steps (Ultra High-Fidelity)`" : "`16 Steps (Fast Studio)`", inline: true },
                    { name: "🎲 Seed", value: seed !== null && seed !== undefined ? `\`${seed}\`` : "`Randomized`", inline: true },
                    { name: "📦 Format", value: `\`${format.toUpperCase()}\``, inline: true },
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~2 Minutes`", inline: true },
                )
                .setFooter({ text: "⚡ Running on Localhost Dedicated Node (70GB Cluster) • Please wait ~2 minutes. Dropping in this channel." })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("YuE error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /breeze
    if (commandName === "breeze") {
        const text = interaction.options.getString("text");
        const mode = interaction.options.getString("mode") || "design";
        const instruction = interaction.options.getString("instruction") || "";
        const refAudio = interaction.options.getAttachment("ref_audio");
        const refText = interaction.options.getString("ref_text") || "";
        const cfgScale = interaction.options.getNumber("cfg_scale") ?? 4.0;
        const seed = interaction.options.getInteger("seed");

        // Clone & Direction modes require reference audio
        if ((mode === "clone" || mode === "direction") && (!refAudio || !refAudio.url)) {
            return interaction.reply({
                content: `❌ **${mode === "clone" ? "Voice Clone" : "Voice Direction"} mode** requires a \`ref_audio\` attachment (.mp3 or .wav)!`,
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "breeze-tts",
                    prompt: text,
                    image_url: JSON.stringify({
                        mode,
                        instruction,
                        ref_audio_url: refAudio ? refAudio.url : "",
                        ref_text: refText,
                        cfg_scale: cfgScale,
                    }),
                    steps: mode,
                    duration: String(cfgScale),
                    seed: seed !== null && seed !== undefined ? String(seed) : "42",
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const modeLabels = {
                design: "🎨 Voice Design",
                clone: "🧬 Voice Clone",
                direction: "🎛️ Voice Direction",
            };

            const embed = new EmbedBuilder()
                .setTitle("🎙️ Xploit AI Lab — Breeze TTS 2")
                .setColor("#00BFFF")
                .setDescription(`Synthesizing speech via **Breeze TTS 2 Neural Engine** — **${modeLabels[mode] || mode}**!`)
                .addFields(
                    { name: "🗣️ Text", value: `\`${text.length > 150 ? text.slice(0, 147) + "..." : text}\``, inline: false },
                    { name: "⚙️ Mode", value: `\`${modeLabels[mode] || mode}\``, inline: true },
                    { name: "🎛️ CFG Scale", value: `\`${cfgScale}\``, inline: true },
                    { name: "🎲 Seed", value: seed !== null && seed !== undefined ? `\`${seed}\`` : "`42 (Default)`", inline: true },
                    ...(instruction ? [{ name: "🎨 Instruction / Direction", value: `\`${instruction.length > 120 ? instruction.slice(0, 117) + "..." : instruction}\``, inline: false }] : []),
                    ...(refAudio ? [{ name: "🎤 Ref Audio", value: `[Listen](${refAudio.url})`, inline: true }] : []),
                    ...(refText ? [{ name: "📝 Ref Transcript", value: `\`${refText.length > 80 ? refText.slice(0, 77) + "..." : refText}\``, inline: false }] : []),
                    { name: "⚡ Quality", value: "`Studio Master (Bilingual EN/ZH)`", inline: true },
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~2 Minutes`", inline: true },
                )
                .setFooter({ text: "⚡ Running on Localhost Dedicated Node (70GB Cluster) • Please wait ~2 minutes. Dropping in this channel." })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("Breeze TTS error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /step-music
    if (commandName === "step-music") {
        const prompt = interaction.options.getString("prompt");
        const lyrics = interaction.options.getString("lyrics") || "";
        const instrumental = interaction.options.getBoolean("instrumental") || false;
        const format = interaction.options.getString("format") || "mp3";
        const bitrate = interaction.options.getInteger("bitrate") || 192;
        const sampleRate = interaction.options.getInteger("sample_rate") || 44100;

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "step-music",
                    prompt: prompt,
                    image_url: lyrics,
                    steps: instrumental ? "true" : "false",
                    duration: "180",
                    seed: "-1",
                    style: JSON.stringify({
                        format: format,
                        bitrate: bitrate,
                        sample_rate: sampleRate,
                        task: "text_to_music",
                    }),
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const embed = new EmbedBuilder()
                .setTitle("🎵 Xploit AI Lab — StepAudio 3 Music")
                .setColor("#FF4500")
                .setDescription("Composing full studio track with **StepFun StepAudio-3 Music Neural Engine**!")
                .addFields(
                    { name: "🎼 Style / Prompt", value: `\`${prompt.length > 150 ? prompt.slice(0, 147) + "..." : prompt}\``, inline: false },
                    { name: "📝 Lyrics", value: lyrics ? `\`${lyrics.length > 100 ? lyrics.slice(0, 97) + "..." : lyrics}\`` : (instrumental ? "`Instrumental Only`" : "`Auto AI Lyrics Composing`"), inline: false },
                    { name: "🎤 Mode", value: instrumental ? "`Instrumental Only`" : "`Full Vocals + Lyrics`", inline: true },
                    { name: "📦 Format", value: `\`${format.toUpperCase()}\``, inline: true },
                    { name: "⚡ Bitrate", value: `\`${bitrate} kbps\``, inline: true },
                    { name: "🎚️ Sample Rate", value: `\`${(sampleRate / 1000).toFixed(1)} kHz\``, inline: true },
                    { name: "🖥️ Host Node", value: "`StepAudio Cloud Cluster`", inline: true },
                    { name: "⏳ Est. Render", value: "`~45 Seconds`", inline: true },
                )
                .setFooter({ text: "⚡ Running on StepAudio High-Speed Cloud • Dropping in this channel." })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("StepAudio Music error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /triposplat
    if (commandName === "triposplat") {
        const attachment = interaction.options.getAttachment("image");
        const quality = interaction.options.getString("quality") || "262144";
        const steps = interaction.options.getInteger("steps") || 20;
        const guidance = interaction.options.getNumber("guidance") ?? 3.0;
        const format = interaction.options.getString("format") || "ply";
        const seed = interaction.options.getInteger("seed");

        if (!attachment || !attachment.url) {
            return interaction.reply({ content: "❌ Please attach a source image to turn into 3D.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "triposplat",
                    prompt: quality,
                    image_url: attachment.url,
                    steps: String(steps),
                    duration: String(guidance),
                    style: format,
                    seed: seed !== null && seed !== undefined ? String(seed) : "-1",
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const embed = new EmbedBuilder()
                .setTitle("🧊 Xploit AI Lab — TripoSplat 3D Gaussian Splatting")
                .setColor("#00CED1")
                .setDescription("Generating high-fidelity **3D Gaussian Splat model** via **TripoSplat Neural Engine**!")
                .addFields(
                    { name: "🖼️ Source Image", value: `[View Uploaded Image](${attachment.url})`, inline: false },
                    { name: "🌐 Point Density", value: `\`${Number(quality).toLocaleString()} Gaussians\``, inline: true },
                    { name: "⚡ Steps", value: `\`${steps} Steps\``, inline: true },
                    { name: "🎯 Guidance Scale", value: `\`${guidance}\``, inline: true },
                    { name: "📦 3D Format", value: `\`${format.toUpperCase()}\``, inline: true },
                    { name: "🎲 Seed", value: seed !== null && seed !== undefined ? `\`${seed}\`` : "`Randomized`", inline: true },
                    { name: "🌐 Free 3D Viewer", value: "[PlayCanvas SuperSplat](https://playcanvas.com/supersplat/editor) • Drag & drop .ply/.splat to view!", inline: false },
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~15 - 30 Seconds`", inline: true },
                )
                .setFooter({ text: "⚡ TripoSplat 3D Engine • Drag & drop output into SuperSplat to view in 3D!" })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("TripoSplat error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /openvoice
    if (commandName === "openvoice") {
        const text = interaction.options.getString("text");
        const refAudio = interaction.options.getAttachment("ref_audio");
        const style = interaction.options.getString("style") || "en_us";

        if (!refAudio || !refAudio.url) {
            return interaction.reply({ content: "❌ Please attach a reference audio file (.mp3/.wav) to clone.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "openvoice",
                    prompt: text,
                    image_url: refAudio.url,
                    steps: style,
                    duration: "0",
                    style: style,
                    seed: "-1",
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const embed = new EmbedBuilder()
                .setTitle("🎙️ Xploit AI Lab — OpenVoice V2 Voice Cloning")
                .setColor("#4169E1")
                .setDescription("Cloning target voice & synthesizing speech via **MyShell OpenVoice V2 Neural Engine**!")
                .addFields(
                    { name: "🗣️ Text", value: `\`${text.length > 150 ? text.slice(0, 147) + "..." : text}\``, inline: false },
                    { name: "🎤 Reference Audio", value: `[Listen to Source](${refAudio.url})`, inline: true },
                    { name: "🌍 Style / Language", value: `\`${style.toUpperCase()}\``, inline: true },
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~15 - 30 Seconds`", inline: true },
                )
                .setFooter({ text: "⚡ OpenVoice V2 Instant Cloning • Dropping audio in this channel." })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("OpenVoice error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /wan-animate
    if (commandName === "wan-animate") {
        const video = interaction.options.getAttachment("video");
        const image = interaction.options.getAttachment("image");
        const mode = interaction.options.getString("mode") || "Character Swap";
        const duration = interaction.options.getNumber("duration") ?? 2.0;
        const resolution = interaction.options.getString("resolution") || "Low Res";

        if (!video || !video.url || !image || !image.url) {
            return interaction.reply({ content: "❌ Please attach both a driving video (.mp4) and target character image.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "wan-animate",
                    prompt: video.url,
                    image_url: image.url,
                    steps: mode,
                    duration: String(duration),
                    style: resolution,
                    seed: "-1",
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const embed = new EmbedBuilder()
                .setTitle("🎬 Xploit AI Lab — Wan 2.2 Character Animate")
                .setColor("#9400D3")
                .setDescription("Animating character with driving video motion via **Wan 2.2 Animate Pipeline**!")
                .addFields(
                    { name: "🎥 Driving Video", value: `[View Driving Video](${video.url})`, inline: true },
                    { name: "🖼️ Target Character", value: `[View Target Frame](${image.url})`, inline: true },
                    { name: "🎭 Mode", value: `\`${mode}\``, inline: true },
                    { name: "⏱️ Duration", value: `\`${duration}s\``, inline: true },
                    { name: "📺 Resolution", value: `\`${resolution}\``, inline: true },
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~1 - 2 Minutes`", inline: true },
                )
                .setFooter({ text: "⚡ Wan 2.2 Animate • Primary with Auto Fallback • Dropping video in this channel." })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("Wan Animate error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /viggle
    if (commandName === "viggle") {
        const video = interaction.options.getAttachment("video");
        const character = interaction.options.getAttachment("character");
        const seed = interaction.options.getInteger("seed");

        if (!video || !video.url || !character || !character.url) {
            return interaction.reply({ content: "❌ Please attach both a motion reference video (.mp4) and character image.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "viggle",
                    prompt: video.url,
                    image_url: character.url,
                    steps: "20",
                    duration: "0",
                    seed: seed !== null && seed !== undefined ? String(seed) : "-1",
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const embed = new EmbedBuilder()
                .setTitle("🕺 Xploit AI Lab — Viggle Character Animate")
                .setColor("#32CD32")
                .setDescription("Transferring motion to custom character via **Viggle AI Neural Engine**!")
                .addFields(
                    { name: "🎥 Motion Video", value: `[View Motion Video](${video.url})`, inline: true },
                    { name: "👤 Character", value: `[View Character Image](${character.url})`, inline: true },
                    { name: "🎲 Seed", value: seed !== null && seed !== undefined ? `\`${seed}\`` : "`42 (Default)`", inline: true },
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~1 - 2 Minutes`", inline: true },
                )
                .setFooter({ text: "⚡ Viggle Character Dance & Motion Transfer • Dropping in this channel." })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("Viggle error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /hq-video
    if (commandName === "hq-video") {
        const image = interaction.options.getAttachment("image");
        const prompt = interaction.options.getString("prompt") || "make this image come alive, cinematic motion, smooth animation, 4k ultra realistic";
        const duration = interaction.options.getString("duration") || "3.5";
        const fps = interaction.options.getString("fps") || "16";
        const upscale = interaction.options.getBoolean("upscale") ?? true;
        const seed = interaction.options.getInteger("seed");

        if (!image || !image.url) {
            return interaction.reply({ content: "❌ Please attach an image to animate.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "hq-video",
                    prompt: prompt,
                    image_url: image.url,
                    steps: fps,
                    duration: duration,
                    style: upscale ? "true" : "false",
                    seed: seed !== null && seed !== undefined ? String(seed) : "-1",
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const embed = new EmbedBuilder()
                .setTitle("🎥 Xploit AI Lab — HighQualityVideo Engine")
                .setColor("#FF1493")
                .setDescription("Generating smooth high-framerate video via **HighQualityVideo Pipeline**!")
                .addFields(
                    { name: "🎞️ Motion Prompt", value: `\`${prompt.length > 150 ? prompt.slice(0, 147) + "..." : prompt}\``, inline: false },
                    { name: "🖼️ Base Frame", value: `[View Image](${image.url})`, inline: true },
                    { name: "⏱️ Duration", value: `\`${duration}s\``, inline: true },
                    { name: "⚡ Smoothness / FPS", value: `\`${fps} FPS\``, inline: true },
                    { name: "🔍 4K Upscale", value: upscale ? "`Active (UltraSharp)`" : "`Off`", inline: true },
                    { name: "🎲 Seed", value: seed !== null && seed !== undefined ? `\`${seed}\`` : "`Randomized`", inline: true },
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~1 - 2 Minutes`", inline: true },
                )
                .setFooter({ text: "⚡ HighQualityVideo Engine • Dropping video in this channel." })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("HQ Video error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /dream-video
    if (commandName === "dream-video") {
        const image = interaction.options.getAttachment("image");
        const prompt = interaction.options.getString("prompt") || "Make this image come alive with smooth, realistic motion.";
        const cameraMotion = interaction.options.getString("camera_motion") || "Slow Push In";
        const motionStyle = interaction.options.getString("motion_style") || "Cinematic";
        const duration = interaction.options.getString("duration") || "3.5";
        const aspectRatio = interaction.options.getString("aspect_ratio") || "Auto (keep source ratio)";
        const seed = interaction.options.getInteger("seed");

        if (!image || !image.url) {
            return interaction.reply({ content: "❌ Please attach an image to animate.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: "ai-lab.yml",
                ref: "main",
                inputs: {
                    action_type: "dream-video",
                    prompt: prompt,
                    image_url: image.url,
                    steps: cameraMotion,
                    duration: duration,
                    style: JSON.stringify({
                        motion_style: motionStyle,
                        aspect_ratio: aspectRatio,
                    }),
                    seed: seed !== null && seed !== undefined ? String(seed) : "-1",
                    user_id: interaction.user.id,
                    channel_id: interaction.channelId,
                },
            });

            const embed = new EmbedBuilder()
                .setTitle("🎬 Xploit AI Lab — Dream Wan 2.2 Turbo Video")
                .setColor("#1E90FF")
                .setDescription("Generating cinematic video with custom camera trajectory via **Dream Wan 2.2 AOTI Engine**!")
                .addFields(
                    { name: "🎥 Motion Prompt", value: `\`${prompt.length > 150 ? prompt.slice(0, 147) + "..." : prompt}\``, inline: false },
                    { name: "🖼️ Base Frame", value: `[View Image](${image.url})`, inline: true },
                    { name: "📹 Camera Motion", value: `\`${cameraMotion}\``, inline: true },
                    { name: "🎨 Motion Style", value: `\`${motionStyle}\``, inline: true },
                    { name: "⏱️ Duration", value: `\`${duration}s\``, inline: true },
                    { name: "📐 Aspect Ratio", value: `\`${aspectRatio}\``, inline: true },
                    { name: "🎲 Seed", value: seed !== null && seed !== undefined ? `\`${seed}\`` : "`Randomized`", inline: true },
                    { name: "🖥️ Host Node", value: "`Localhost Cluster (70GB VRAM)`", inline: true },
                    { name: "⏳ Est. Render", value: "`~1 - 2 Minutes`", inline: true },
                )
                .setFooter({ text: "⚡ Dream Wan 2.2 FP8-DA AOTI Video Engine • Dropping in this channel." })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("Dream Video error:", err);
            return interaction.editReply({
                content: `❌ **Dispatch Error:** ${err.message || "Failed to trigger AI Lab runner"}.`,
            });
        }
    }

    // /tools
    if (commandName === "tools") {
        const os = interaction.options.getString("os");
        const TOOL_LISTS = {
            kali: {
                color: "#FF0000",
                icon: "💀",
                label: "Kali Linux — Full Arsenal (100+ Tools)",
                fields: [
                    { name: "🔍 Recon",          value: "`nmap` `masscan` `amass` `subfinder` `theharvester` `recon-ng` `fierce` `dnsenum` `dnsrecon` `httprobe` `waybackurls` `assetfinder` `gau`" },
                    { name: "🌐 Web Scanning",    value: "`nuclei` `nikto` `sqlmap` `wpscan` `whatweb` `gobuster` `dirb` `wfuzz` `ffuf` `dalfox` `naabu` `httpx`" },
                    { name: "🔑 Password Attack", value: "`hydra` `medusa` `john` `hashcat` `crunch` `cewl` `wordlists/rockyou`" },
                    { name: "📡 Network",         value: "`tcpdump` `wireshark` `socat` `ettercap` `arpwatch` `macchanger` `dsniff` `proxychains4` `tor`" },
                    { name: "💥 Exploitation",    value: "`metasploit` `msfvenom` `exploitdb` `searchsploit`" },
                    { name: "📶 Wireless",        value: "`aircrack-ng` `wifite` `reaver` `mdk4`" },
                    { name: "🔬 Forensics / RE",  value: "`binwalk` `foremost` `steghide` `exiftool` `autopsy` `gdb` `radare2` `strace` `ltrace`" },
                    { name: "🐍 Python / Go",     value: "`impacket` `scapy` `pwntools` `shodan` `paramiko` `ldap3` `subfinder` `httpx` `ffuf` `gau`" },
                ],
            },
            ubuntu: {
                color: "#FF6600",
                icon: "🐧",
                label: "Ubuntu 22.04 — Tools",
                fields: [{ name: "🛠️ Installed", value: "`nmap` `sqlmap` `nuclei` `dirb` `net-tools` `ncat` `python3` `git` `curl` `wget`" }],
            },
            parrot: {
                color: "#00CED1",
                icon: "🦜",
                label: "Parrot OS — Tools",
                fields: [{ name: "🛠️ Installed", value: "`nmap` `sqlmap` `nikto` `gobuster` `john` `hashcat` `tor` `whois` `dnsutils`" }],
            },
            debian: {
                color: "#A80030",
                icon: "🌀",
                label: "Debian 12 — Tools",
                fields: [{ name: "🛠️ Installed", value: "`nmap` `net-tools` `python3` `git` `curl` `wget`" }],
            },
        };

        const info = TOOL_LISTS[os] || TOOL_LISTS.ubuntu;
        const embed = new EmbedBuilder()
            .setTitle(`${info.icon} ${info.label}`)
            .setColor(info.color)
            .setFooter({ text: "Type any tool name in the VPS terminal to use it." })
            .setTimestamp();
        for (const f of info.fields) embed.addFields(f);

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // /vps
    if (commandName === "vps") {
        if (interaction.channelId !== VPS_CHANNEL_ID)
            return interaction.reply({
                content: `⚠️ Use this command in <#${VPS_CHANNEL_ID}> only.`,
                ephemeral: true,
            });
        if (interaction.guildId !== XPLOIT_HUB_ID)
            return interaction.reply({
                content: "❌ Exclusive to **Xploit HUB**.",
                ephemeral: true,
            });

        cleanExpiredSessions();

        const isSuper = SUPER_ADMINS.has(interaction.user.id);

        if (!isSuper && getUserSession(interaction.user.id))
            return interaction.reply({
                content: `🚫 You already have an active VPS. Use \`/vps-status\` to check it.`,
                ephemeral: true,
            });

        const cd = getCooldown(interaction.user.id);
        if (!isSuper && cd > 0)
            return interaction.reply({
                content: `⏳ **Cooldown:** Wait \`${Math.ceil(cd / 60000)} minutes\` before your next VPS.`,
                ephemeral: true,
            });

        if (db.sessions.length >= MAX_SESSIONS)
            return interaction.reply({
                content: `🚫 All **${MAX_SESSIONS}** slots are full. Check <#${LIVE_CHANNEL_ID}> for availability.`,
                ephemeral: true,
            });

        const osKey = interaction.options.getString("os");
        const wallKey =
            interaction.options.getString("wallpaper") || "wall_default";
        const wallpaper = WALLPAPER_MAP[wallKey];
        const osInfo = OS_MAP[osKey];

        if (!osInfo)
            return interaction.reply({
                content: "❌ Unknown OS selected.",
                ephemeral: true,
            });

        const duration = interaction.options.getString("duration");

        const accessHint = {
            browser: "🌐 You'll get a **browser link** — open it and enter password `phantom`.",
            rdp:     "🖥️ You'll get a **bore.pub address** — open Remote Desktop Connection, User: `xploit`, Pass: `phantom`.",
            vpn:     "🔒 You'll get **2 options** in your DMs: **SSTP** (Windows built-in VPN, zero extra software) + **OpenVPN** `.ovpn` file. Both route all traffic through the 1Gbps server.",
            proxy:   "🌐 You'll get **SOCKS5 proxy credentials** in your DMs — works in any browser (FoxyProxy) or system proxy settings.",
        }[osInfo.access];

        try {
            const _vpsWorker = getNextWorker();
            octokit._nextWorker = _vpsWorker;
            db.sessions.push({
                userId: interaction.user.id,
                userName: interaction.user.username,
                os: osKey,
                clusterId: _vpsWorker.id,
                clusterName: _vpsWorker.name,
                startedAt: Date.now(),
                expiresAt: Date.now() + (parseInt(duration) + 5) * 60000,
            });
            saveDB();
            updateLiveMessage();

            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`${osInfo.icon} ${osInfo.label} Launching...`)
                        .setColor("#00FF41")
                        .setDescription(
                            `Your machine is spinning up.\n**Check your DMs in 2–3 minutes** for the connection details.\n\n${accessHint}`,
                        )
                        .addFields(
                            {
                                name: "⏱ Duration",
                                value: `\`${duration} minutes\``,
                                inline: true,
                            },
                            {
                                name: "🔢 Slot",
                                value: `\`${db.sessions.length} / ${MAX_SESSIONS}\``,
                                inline: true,
                            },
                        )
                        .setFooter({
                            text: "Use /vps-status to check your session anytime.",
                        }),
                ],
                ephemeral: true,
            });

            await octokit.actions.createWorkflowDispatch({
                owner: REPO_OWNER,
                repo: REPO_NAME,
                workflow_id: osInfo.workflow,
                ref: "main",
                inputs: {
                    user_id: interaction.user.id,
                    user_name: interaction.user.username,
                    duration: duration,
                    wallpaper_url: wallpaper,
                },
            });
        } catch (error) {
            console.error("Dispatch error:", error);
            db.sessions = db.sessions.filter(
                (s) => s.userId !== interaction.user.id,
            );
            saveDB();
            updateLiveMessage();
            await interaction.followUp({
                content: `❌ **Launch Failed:** GitHub Actions dispatch error. Try again shortly.`,
                ephemeral: true,
            });
        }
    }
    // /vpn and /proxy
    if (commandName === "vpn" || commandName === "proxy") {
        if (interaction.channelId !== VPS_CHANNEL_ID)
            return interaction.reply({
                content: `⚠️ Use this command in <#${VPS_CHANNEL_ID}> only.`,
                ephemeral: true,
            });
        if (interaction.guildId !== XPLOIT_HUB_ID)
            return interaction.reply({
                content: "❌ Exclusive to **Xploit HUB**.",
                ephemeral: true,
            });

        cleanExpiredSessions();

        const isSuper = SUPER_ADMINS.has(interaction.user.id);

        if (!isSuper && getUserSession(interaction.user.id))
            return interaction.reply({
                content: `🚫 You already have an active session. Use \`/vps-status\` to check it.`,
                ephemeral: true,
            });

        const cd = getCooldown(interaction.user.id);
        if (!isSuper && cd > 0)
            return interaction.reply({
                content: `⏳ **Cooldown:** Wait \`${Math.ceil(cd / 60000)} minutes\` before your next session.`,
                ephemeral: true,
            });

        if (db.sessions.length >= MAX_SESSIONS)
            return interaction.reply({
                content: `🚫 All **${MAX_SESSIONS}** slots are full.`,
                ephemeral: true,
            });

        const osKey    = commandName;
        const osInfo   = OS_MAP[osKey];
        const duration = interaction.options.getString("duration");

        const hints = {
            vpn:   "🔒 You'll get an **OpenVPN `.ovpn` file** in your DMs — import it in the OpenVPN client and connect. All traffic routes through the 1Gbps server.",
            proxy: "🌐 You'll get **SOCKS5 proxy credentials** in your DMs — configure in any browser (FoxyProxy) or system proxy settings.",
        };

        try {
            db.sessions.push({
                userId:    interaction.user.id,
                userName:  interaction.user.username,
                os:        osKey,
                startedAt: Date.now(),
                expiresAt: Date.now() + (parseInt(duration) + 5) * 60000,
            });
            saveDB();
            updateLiveMessage();

            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`${osInfo.icon} ${osInfo.label} Launching...`)
                        .setColor("#00FF41")
                        .setDescription(
                            `Server is spinning up.\n**Check your DMs in 1–2 minutes** for connection details.\n\n${hints[osKey]}`,
                        )
                        .addFields(
                            { name: "⏱ Duration", value: `\`${duration} minutes\``, inline: true },
                            { name: "🔢 Slot",     value: `\`${db.sessions.length} / ${MAX_SESSIONS}\``, inline: true },
                        )
                        .setFooter({ text: "Use /vps-status to check your session anytime." }),
                ],
                ephemeral: true,
            });

            await octokit.actions.createWorkflowDispatch({
                owner:       REPO_OWNER,
                repo:        REPO_NAME,
                workflow_id: osInfo.workflow,
                ref:         "main",
                inputs: {
                    user_id:   interaction.user.id,
                    user_name: interaction.user.username,
                    duration:  duration,
                },
            });
        } catch (error) {
            console.error("Dispatch error:", error);
            db.sessions = db.sessions.filter((s) => s.userId !== interaction.user.id);
            saveDB();
            updateLiveMessage();
            await interaction.followUp({
                content: `❌ **Launch Failed:** GitHub Actions dispatch error. Try again shortly.`,
                ephemeral: true,
            });
        }
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
