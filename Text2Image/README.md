# ComfyUI Text2Image Panel for After Effects

A ScriptUI panel that brings text-to-image AI generation directly into Adobe After Effects via ComfyUI.

## Features

- **Text-to-Image Generation**: Generate AI images from text prompts without leaving After Effects
- **Full Parameter Control**: Adjust resolution, steps, CFG, sampler, scheduler, and seed settings
- **Positive & Negative Prompts**: Fine-tune your generations with detailed prompt control
- **Workflow Caching**: Instant loading of previously used workflows with automatic cache invalidation
- **API Introspection**: Dynamically loads available samplers and schedulers from your ComfyUI installation
- **Current Value Extraction**: Automatically applies workflow's existing parameter values to the UI
- **Automatic Import**: Generated images are automatically imported into your After Effects project
- **Persistent Settings**: Host, port, and workflow preferences are saved between sessions

## Installation

1. Copy `ComfyUI_Text2Image.jsx` to your After Effects Scripts folder:
   ```
   C:\Users\[Username]\AppData\Roaming\Adobe\After Effects\[Version]\Scripts\ScriptUI Panels\
   ```
   
2. Restart After Effects

3. Open the panel via **Window → ComfyUI_Text2Image.jsx**

## Requirements

- Adobe After Effects (tested on 2024+)
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) running locally or on network
- ComfyUI API workflow JSON file (text-to-image workflow)

## Usage

### Basic Workflow

1. **Start ComfyUI** with your desired checkpoint/model loaded

2. **Configure Connection**:
   - Host: `127.0.0.1` (default)
   - Port: `8188` (ComfyUI default)

3. **Select Workflow**:
   - Click **Choose...** to select your ComfyUI API workflow JSON
   - The panel will automatically detect available samplers, schedulers, and parameter ranges
   - Current workflow values (steps, CFG, etc.) are loaded into the UI

4. **Set Generation Parameters**:
   - **Positive Prompt**: Describe what you want to generate
   - **Negative Prompt**: Specify what to avoid (if workflow supports it)
   - **Sampler**: Choose from dynamically loaded samplers (euler, dpmpp_2m, etc.)
   - **Scheduler**: Select scheduler (karras, exponential, etc.)
   - **Steps**: Number of sampling steps (range varies by workflow)
   - **CFG**: Classifier-Free Guidance scale (range varies by workflow)

5. **Set Image Dimensions**:
   - **Use comp size**: Automatically match active composition dimensions
   - **Manual**: Enter custom width/height
   - **Snap**: Snap dimensions to multiples (64 for SDXL, 8 for SD1.5)
   - **Max W/H**: Cap maximum dimensions

6. **Configure Seed**:
   - **Fixed**: Use specific seed for reproducible results
   - **Random per run**: Generate new random seed each time

7. **Click Generate**: 
   - The panel sends your request to ComfyUI
   - Progress is displayed in the status bar
   - Generated image is automatically imported into your project
   - Optionally add directly to active composition

### Workflow Caching

The panel caches workflow information for instant loading:

- **Cached Dropdown**: Select previously loaded workflows from the "Cached:" dropdown
- **Instant Loading**: Cached workflows load without API calls (0 seconds vs 2-3 seconds)
- **Auto-Invalidation**: Cache automatically refreshes if workflow file is modified
- **Clear Cache**: Remove all cached workflows with the "Clear Cache" button

### Advanced Features

#### API Introspection
The panel automatically:
- Fetches available samplers and schedulers from ComfyUI
- Extracts min/max ranges for steps, CFG, and other parameters
- Detects whether workflow supports negative prompts
- Adapts UI controls to match workflow capabilities

#### Current Value Extraction
When loading a workflow, the panel:
- Reads current parameter values from the workflow JSON
- Pre-populates sliders and dropdowns with these values
- Ensures you start with the workflow's intended settings

#### Dimension Handling
- **Snap to Grid**: Ensures dimensions are multiples of 8 or 64 (important for latent space)
- **Max Caps**: Prevents VRAM overflow by capping dimensions
- **Comp Integration**: Automatically uses composition dimensions if enabled

## Workflow Requirements

Your ComfyUI workflow JSON must include:

1. **CLIPTextEncode node** with `text` input for positive prompt
2. **Optional second CLIPTextEncode** for negative prompt
3. **KSampler or KSamplerAdvanced node** with:
   - `steps` (INT)
   - `cfg` (FLOAT)
   - `sampler_name` (STRING)
   - `scheduler` (STRING)
   - `seed` (INT)
4. **EmptyLatentImage node** with `width` and `height` inputs
5. **SaveImage or equivalent output node**

## Keyboard Shortcuts

- **Tab**: Navigate between fields
- **Enter**: In text fields applies changes
- **Slider + Drag**: Adjust values smoothly
- **Text Field Entry**: Type exact values for precise control

## Troubleshooting

### "Could not connect to 127.0.0.1:8188"
- Ensure ComfyUI is running
- Check host/port settings match your ComfyUI instance
- Verify firewall isn't blocking connections

### "No sampler node found in workflow"
- Workflow must contain KSampler or KSamplerAdvanced node
- Export workflow as API format (not UI format)

### "Workflow file modified, invalidating cache"
- Normal behavior when workflow is edited
- Panel will reload fresh data from ComfyUI API

### Sliders show wrong ranges
- Click "Choose..." to reload workflow
- Cache will refresh automatically if file was modified
- Use "Clear Cache" to force complete refresh

### Negative prompt disabled
- Workflow must have two CLIPTextEncode nodes
- Panel auto-detects support when loading workflow

## Cache File Locations

- **Settings**: `%AppData%\comfyui_text2image_settings.json`
- **Workflow Cache**: `%AppData%\comfyui_text2image_workflow_cache.json`
- **Log File**: `%TEMP%\Comfy_T2I_Panel.log`

## Tips

- Use **Fixed seed** for consistent results across generations
- **Random per run** is great for exploring variations
- **Workflow caching** makes switching between workflows instant
- **Snap to 64** for SDXL models, **snap to 8** for SD1.5
- Check the log file if something goes wrong
- The panel remembers your last used settings

## License

MIT License - Free for personal and commercial use

## Related Panels

- [Image2Image Panel](../Image2Image/) - Transform existing images with AI
- [JSON Reader Panel](../JsonReader/) - Inspect ComfyUI generation metadata
