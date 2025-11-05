/* ComfyUI Panel Generator
   Analyzes a ComfyUI workflow and generates a custom ScriptUI panel for it.
   Run this script once per workflow to create a dedicated panel.
   
   Usage:
   1. File > Scripts > Run Script File... > ComfyUI_GeneratePanel.jsx
   2. Select your workflow JSON file
   3. Enter ComfyUI host/port
   4. Panel will be generated in ScriptUI Panels folder
   5. Restart After Effects to use the new panel
*/

(function() {
  
  // ====== CONFIGURATION ======
  var DEFAULT_HOST = "127.0.0.1";
  var DEFAULT_PORT = "8188";
  
  // ====== LOGGING ======
  var LOG = new File(Folder.temp.fsName + "/ComfyUI_PanelGenerator.log");
  
  function log(msg){
    try {
      if (LOG.open("a")){
        LOG.writeln(new Date().toISOString() + " " + msg);
        LOG.close();
      }
    } catch(e) {}
  }
  
  function die(msg, detail){ 
    log("FAIL: " + msg + " :: " + (detail || "")); 
    alert(msg + (detail ? ("\n\nDetail:\n" + detail) : "") + "\n\nLog: " + LOG.fsName); 
    throw new Error(msg); 
  }
  
  // ====== HTTP HELPERS ======
  function httpRequest(method, path, headers, body, parseJSON, expectJSON, host, port){
    var CRLF = "\r\n";
    var socket = new Socket();
    
    if (!socket.open(host + ":" + port, "binary")) {
      return {status:0, error:"Cannot connect to " + host + ":" + port};
    }
    
    var req = method + " " + path + " HTTP/1.1" + CRLF;
    req += "Host: " + host + CRLF;
    req += "Connection: close" + CRLF;
    
    if (headers) {
      for (var k in headers) {
        if (headers[k]) req += k + ": " + headers[k] + CRLF;
      }
    }
    
    if (body != null){
      req += "Content-Length: " + body.length + CRLF;
      req += CRLF + body;
    } else {
      req += CRLF;
    }
    
    socket.write(req);
    
    var resp = "";
    while (!socket.eof) {
      var chunk = socket.read(1024);
      if (chunk) resp += chunk;
    }
    socket.close();
    
    var parts = resp.split(CRLF + CRLF);
    var head = parts[0] || "";
    var bodyText = parts.slice(1).join(CRLF + CRLF);
    
    var statusLine = head.split(CRLF)[0] || "";
    var statusMatch = statusLine.match(/HTTP\/\S+\s+(\d+)/);
    var status = statusMatch ? parseInt(statusMatch[1]) : 0;
    
    var result = {status: status, body: bodyText};
    
    if (parseJSON && bodyText) {
      try {
        result.json = JSON.parse(bodyText);
      } catch(e) {
        result.parseError = e.toString();
      }
    }
    
    return result;
  }
  
  function httpGetObjectInfo(host, port){
    var r = httpRequest("GET", "/object_info", {"Accept":"application/json"}, null, false, true, host, port);
    if (r.status !== 200 || !r.body) return null;
    try { 
      return JSON.parse(r.body); 
    } catch(e){ 
      log("JSON parse error from /object_info: " + e); 
      return null; 
    }
  }
  
  // ====== WORKFLOW ANALYSIS ======
  function analyzeWorkflow(workflow, objectInfo) {
    var analysis = {
      promptNodes: [],
      negativePromptNodes: [],
      samplerNodes: [],
      loraNodes: [],
      sizeNodes: [],
      checkpointNode: null,
      hasNegativePrompt: false
    };
    
    // Find all relevant nodes
    for (var nodeId in workflow) {
      var node = workflow[nodeId];
      if (!node || !node.class_type) continue;
      
      var nodeClass = String(node.class_type);
      
      // CLIPTextEncode nodes (prompts)
      if (nodeClass === "CLIPTextEncode" && node.inputs && node.inputs.text !== undefined) {
        analysis.promptNodes.push({
          id: nodeId,
          text: node.inputs.text || ""
        });
      }
      
      // KSampler nodes
      if (nodeClass === "KSampler" || nodeClass === "KSamplerAdvanced") {
        var samplerInfo = {
          id: nodeId,
          class: nodeClass,
          isAdvanced: (nodeClass === "KSamplerAdvanced"),
          inputs: node.inputs || {}
        };
        
        // Get parameter info from API
        if (objectInfo && objectInfo[nodeClass]) {
          var nodeDef = objectInfo[nodeClass];
          var required = nodeDef.input.required;
          
          samplerInfo.samplers = (required.sampler_name && required.sampler_name[0] instanceof Array) ? required.sampler_name[0] : ["euler"];
          samplerInfo.schedulers = (required.scheduler && required.scheduler[0] instanceof Array) ? required.scheduler[0] : ["normal"];
          
          if (required.steps && required.steps[0] === "INT") {
            var stepsConfig = required.steps[1] || {};
            samplerInfo.stepsRange = {
              min: stepsConfig.min || 1,
              max: stepsConfig.max || 150,
              default: stepsConfig["default"] || 20
            };
          }
          
          if (required.cfg && required.cfg[0] === "FLOAT") {
            var cfgConfig = required.cfg[1] || {};
            samplerInfo.cfgRange = {
              min: cfgConfig.min || 0.0,
              max: cfgConfig.max || 30.0,
              default: cfgConfig["default"] || 8.0,
              step: cfgConfig.step || 0.1
            };
          }
          
          if (required.denoise && required.denoise[0] === "FLOAT") {
            var denoiseConfig = required.denoise[1] || {};
            samplerInfo.denoiseRange = {
              min: denoiseConfig.min || 0.0,
              max: denoiseConfig.max || 1.0,
              default: denoiseConfig["default"] || 1.0,
              step: denoiseConfig.step || 0.01
            };
          }
        }
        
        analysis.samplerNodes.push(samplerInfo);
      }
      
      // LoRA nodes
      if (nodeClass === "LoraLoader" && node.inputs) {
        analysis.loraNodes.push({
          id: nodeId,
          name: node.inputs.lora_name || "unknown",
          strength_model: node.inputs.strength_model || 1.0,
          strength_clip: node.inputs.strength_clip || 1.0
        });
      }
      
      // Size nodes
      if ((nodeClass === "EmptyLatentImage" || nodeClass === "EmptySD3LatentImage") && node.inputs) {
        analysis.sizeNodes.push({
          id: nodeId,
          class: nodeClass,
          width: node.inputs.width || 512,
          height: node.inputs.height || 512
        });
      }
      
      // Checkpoint loader
      if (nodeClass.indexOf("CheckpointLoader") !== -1 && node.inputs && node.inputs.ckpt_name) {
        analysis.checkpointNode = {
          id: nodeId,
          name: node.inputs.ckpt_name
        };
      }
    }
    
    // Detect negative prompt (2nd CLIPTextEncode node)
    if (analysis.promptNodes.length >= 2) {
      analysis.hasNegativePrompt = true;
      analysis.negativePromptNodes.push(analysis.promptNodes[1]);
      analysis.promptNodes = [analysis.promptNodes[0]]; // Keep only first as positive
    }
    
    log("Analysis complete:");
    log("  Prompt nodes: " + analysis.promptNodes.length);
    log("  Negative prompt nodes: " + analysis.negativePromptNodes.length);
    log("  Sampler nodes: " + analysis.samplerNodes.length);
    log("  LoRA nodes: " + analysis.loraNodes.length);
    log("  Size nodes: " + analysis.sizeNodes.length);
    
    return analysis;
  }
  
  // ====== PANEL CODE GENERATION ======
  function buildPanelCode(workflowName, workflow, analysis, host, port) {
    var code = [];
    
    // Header
    code.push("/* Auto-generated ComfyUI Panel");
    code.push("   Workflow: " + workflowName);
    code.push("   Generated: " + new Date().toString());
    code.push("   ");
    code.push("   This panel is specifically designed for this workflow.");
    code.push("   To update: re-run ComfyUI_GeneratePanel.jsx");
    code.push("*/");
    code.push("");
    code.push("(function(thisObj) {");
    code.push("  ");
    
    // Configuration
    code.push("  // ====== CONFIGURATION ======");
    code.push("  var DEFAULT_HOST = \"" + host + "\";");
    code.push("  var DEFAULT_PORT = \"" + port + "\";");
    code.push("  var POLL_MS = 1000;");
    code.push("  ");
    
    // Embedded workflow
    code.push("  // ====== EMBEDDED WORKFLOW ======");
    code.push("  var BASE_WORKFLOW = " + JSON.stringify(workflow, null, 2) + ";");
    code.push("  ");
    
    // Node IDs
    code.push("  // ====== NODE IDs (extracted at generation time) ======");
    if (analysis.promptNodes.length > 0) {
      code.push("  var POSITIVE_PROMPT_NODE = \"" + analysis.promptNodes[0].id + "\";");
    } else {
      code.push("  var POSITIVE_PROMPT_NODE = null;");
    }
    
    if (analysis.negativePromptNodes.length > 0) {
      code.push("  var NEGATIVE_PROMPT_NODE = \"" + analysis.negativePromptNodes[0].id + "\";");
    } else {
      code.push("  var NEGATIVE_PROMPT_NODE = null;");
    }
    
    if (analysis.samplerNodes.length > 0) {
      code.push("  var SAMPLER_NODE = \"" + analysis.samplerNodes[0].id + "\";");
    } else {
      code.push("  var SAMPLER_NODE = null;");
    }
    
    if (analysis.sizeNodes.length > 0) {
      code.push("  var SIZE_NODE = \"" + analysis.sizeNodes[0].id + "\";");
    } else {
      code.push("  var SIZE_NODE = null;");
    }
    
    if (analysis.loraNodes.length > 0) {
      var loraIds = [];
      for (var i = 0; i < analysis.loraNodes.length; i++) {
        loraIds.push("\"" + analysis.loraNodes[i].id + "\"");
      }
      code.push("  var LORA_NODES = [" + loraIds.join(", ") + "];");
    } else {
      code.push("  var LORA_NODES = [];");
    }
    code.push("  ");
    
    // Add all helper functions (HTTP, deepCopy, etc.)
    code.push("  // ====== HELPER FUNCTIONS ======");
    code.push("  // (HTTP, logging, workflow manipulation functions)");
    code.push("  // ... [Same as ComfyUI_Text2Image.jsx] ...");
    code.push("  ");
    
    // UI Creation
    code.push("  // ====== UI CREATION ======");
    code.push("  var win = (thisObj instanceof Panel) ? thisObj : new Window(\"palette\", \"ComfyUI: " + workflowName + "\", undefined, {resizeable:true});");
    code.push("  win.alignChildren = [\"fill\",\"top\"];");
    code.push("  win.spacing = 5;");
    code.push("  win.margins = 10;");
    code.push("  ");
    
    // Prompt section
    if (analysis.promptNodes.length > 0) {
      code.push("  // Prompt");
      code.push("  var promptPanel = win.add(\"panel\", undefined, \"Prompt\");");
      code.push("  promptPanel.alignChildren = [\"fill\",\"top\"];");
      code.push("  var prompt = promptPanel.add(\"edittext\", undefined, \"\", {multiline:true});");
      code.push("  prompt.preferredSize = [400, 60];");
      code.push("  ");
    }
    
    // Negative prompt section
    if (analysis.hasNegativePrompt) {
      code.push("  // Negative Prompt");
      code.push("  var negPromptPanel = win.add(\"panel\", undefined, \"Negative Prompt\");");
      code.push("  negPromptPanel.alignChildren = [\"fill\",\"top\"];");
      code.push("  var negPrompt = negPromptPanel.add(\"edittext\", undefined, \"\", {multiline:true});");
      code.push("  negPrompt.preferredSize = [400, 40];");
      code.push("  ");
    }
    
    // Sampler section
    if (analysis.samplerNodes.length > 0) {
      var sampler = analysis.samplerNodes[0];
      code.push("  // Sampling Settings");
      code.push("  var samplerPanel = win.add(\"panel\", undefined, \"Sampling\");");
      code.push("  samplerPanel.alignChildren = [\"fill\",\"top\"];");
      code.push("  ");
      
      // Sampler dropdown
      if (sampler.samplers) {
        var samplersList = "[\"" + sampler.samplers.join("\", \"") + "\"]";
        code.push("  var sampRow = samplerPanel.add(\"group\");");
        code.push("  sampRow.add(\"statictext\", undefined, \"Sampler:\");");
        code.push("  var ddSampler = sampRow.add(\"dropdownlist\", undefined, " + samplersList + ");");
        
        // Select current sampler
        var currentSampler = sampler.inputs.sampler_name || sampler.samplers[0];
        var samplerIndex = sampler.samplers.indexOf(currentSampler);
        code.push("  ddSampler.selection = " + (samplerIndex >= 0 ? samplerIndex : 0) + ";");
        code.push("  ");
        
        // Scheduler dropdown
        if (sampler.schedulers) {
          var schedulersList = "[\"" + sampler.schedulers.join("\", \"") + "\"]";
          code.push("  var schedRow = samplerPanel.add(\"group\");");
          code.push("  schedRow.add(\"statictext\", undefined, \"Scheduler:\");");
          code.push("  var ddScheduler = schedRow.add(\"dropdownlist\", undefined, " + schedulersList + ");");
          
          var currentScheduler = sampler.inputs.scheduler || sampler.schedulers[0];
          var schedulerIndex = sampler.schedulers.indexOf(currentScheduler);
          code.push("  ddScheduler.selection = " + (schedulerIndex >= 0 ? schedulerIndex : 0) + ";");
          code.push("  ");
        }
      }
      
      // Steps slider
      if (sampler.stepsRange) {
        var currentSteps = sampler.inputs.steps || sampler.stepsRange.default;
        code.push("  var stepsRow = samplerPanel.add(\"group\");");
        code.push("  stepsRow.add(\"statictext\", undefined, \"Steps:\");");
        code.push("  var stepsSlider = stepsRow.add(\"slider\", undefined, " + currentSteps + ", " + sampler.stepsRange.min + ", " + sampler.stepsRange.max + ");");
        code.push("  var stepsVal = stepsRow.add(\"edittext\", undefined, \"" + currentSteps + "\");");
        code.push("  stepsVal.characters = 4;");
        code.push("  stepsSlider.onChanging = function() { stepsVal.text = String(Math.round(stepsSlider.value)); };");
        code.push("  ");
      }
      
      // CFG slider
      if (sampler.cfgRange) {
        var currentCfg = sampler.inputs.cfg || sampler.cfgRange.default;
        code.push("  var cfgRow = samplerPanel.add(\"group\");");
        code.push("  cfgRow.add(\"statictext\", undefined, \"CFG:\");");
        code.push("  var cfgSlider = cfgRow.add(\"slider\", undefined, " + currentCfg + ", " + sampler.cfgRange.min + ", " + sampler.cfgRange.max + ");");
        code.push("  var cfgVal = cfgRow.add(\"edittext\", undefined, \"" + currentCfg.toFixed(1) + "\");");
        code.push("  cfgVal.characters = 4;");
        code.push("  cfgSlider.onChanging = function() { cfgVal.text = cfgSlider.value.toFixed(1); };");
        code.push("  ");
      }
      
      // Denoise slider (if advanced sampler)
      if (sampler.denoiseRange) {
        var currentDenoise = sampler.inputs.denoise || sampler.denoiseRange.default;
        code.push("  var denRow = samplerPanel.add(\"group\");");
        code.push("  denRow.add(\"statictext\", undefined, \"Denoise:\");");
        code.push("  var denSlider = denRow.add(\"slider\", undefined, " + currentDenoise + ", " + sampler.denoiseRange.min + ", " + sampler.denoiseRange.max + ");");
        code.push("  var denVal = denRow.add(\"edittext\", undefined, \"" + currentDenoise.toFixed(2) + "\");");
        code.push("  denVal.characters = 4;");
        code.push("  denSlider.onChanging = function() { denVal.text = denSlider.value.toFixed(2); };");
        code.push("  ");
      }
    }
    
    // LoRA section
    if (analysis.loraNodes.length > 0) {
      code.push("  // LoRA Settings");
      code.push("  var loraPanel = win.add(\"panel\", undefined, \"LoRAs\");");
      code.push("  loraPanel.alignChildren = [\"fill\",\"top\"];");
      code.push("  ");
      
      for (var i = 0; i < analysis.loraNodes.length; i++) {
        var lora = analysis.loraNodes[i];
        var loraVarPrefix = "lora" + (i + 1);
        
        code.push("  // LoRA " + (i + 1) + ": " + lora.name);
        code.push("  var " + loraVarPrefix + "Row = loraPanel.add(\"group\");");
        code.push("  " + loraVarPrefix + "Row.add(\"statictext\", undefined, \"" + lora.name + "\");");
        code.push("  ");
        code.push("  var " + loraVarPrefix + "ModelRow = loraPanel.add(\"group\");");
        code.push("  " + loraVarPrefix + "ModelRow.add(\"statictext\", undefined, \"  Model:\");");
        code.push("  var " + loraVarPrefix + "ModelSlider = " + loraVarPrefix + "ModelRow.add(\"slider\", undefined, " + lora.strength_model + ", 0.0, 2.0);");
        code.push("  var " + loraVarPrefix + "ModelVal = " + loraVarPrefix + "ModelRow.add(\"edittext\", undefined, \"" + lora.strength_model.toFixed(2) + "\");");
        code.push("  " + loraVarPrefix + "ModelVal.characters = 4;");
        code.push("  " + loraVarPrefix + "ModelSlider.onChanging = function() { " + loraVarPrefix + "ModelVal.text = " + loraVarPrefix + "ModelSlider.value.toFixed(2); };");
        code.push("  ");
        code.push("  var " + loraVarPrefix + "ClipRow = loraPanel.add(\"group\");");
        code.push("  " + loraVarPrefix + "ClipRow.add(\"statictext\", undefined, \"  CLIP:\");");
        code.push("  var " + loraVarPrefix + "ClipSlider = " + loraVarPrefix + "ClipRow.add(\"slider\", undefined, " + lora.strength_clip + ", 0.0, 2.0);");
        code.push("  var " + loraVarPrefix + "ClipVal = " + loraVarPrefix + "ClipRow.add(\"edittext\", undefined, \"" + lora.strength_clip.toFixed(2) + "\");");
        code.push("  " + loraVarPrefix + "ClipVal.characters = 4;");
        code.push("  " + loraVarPrefix + "ClipSlider.onChanging = function() { " + loraVarPrefix + "ClipVal.text = " + loraVarPrefix + "ClipSlider.value.toFixed(2); };");
        code.push("  ");
      }
    }
    
    // Size section
    code.push("  // Size");
    code.push("  var sizePanel = win.add(\"panel\", undefined, \"Size\");");
    code.push("  sizePanel.alignChildren = [\"fill\",\"top\"];");
    code.push("  var useComp = sizePanel.add(\"checkbox\", undefined, \"Use comp size\");");
    code.push("  useComp.value = true;");
    code.push("  ");
    
    // Generate button
    code.push("  // Generate Button");
    code.push("  var genBtn = win.add(\"button\", undefined, \"Generate\");");
    code.push("  var statusTxt = win.add(\"statictext\", undefined, \"Ready\");");
    code.push("  statusTxt.alignment = [\"fill\",\"top\"];");
    code.push("  ");
    
    // Generate button handler
    code.push("  genBtn.onClick = function() {");
    code.push("    try {");
    code.push("      statusTxt.text = \"Generating...\";");
    code.push("      ");
    code.push("      // Deep copy workflow");
    code.push("      var wf = JSON.parse(JSON.stringify(BASE_WORKFLOW));");
    code.push("      ");
    
    // Modify prompt
    if (analysis.promptNodes.length > 0) {
      code.push("      // Set prompt");
      code.push("      if (POSITIVE_PROMPT_NODE && wf[POSITIVE_PROMPT_NODE]) {");
      code.push("        wf[POSITIVE_PROMPT_NODE].inputs.text = prompt.text;");
      code.push("      }");
      code.push("      ");
    }
    
    // Modify negative prompt
    if (analysis.hasNegativePrompt) {
      code.push("      // Set negative prompt");
      code.push("      if (NEGATIVE_PROMPT_NODE && wf[NEGATIVE_PROMPT_NODE]) {");
      code.push("        wf[NEGATIVE_PROMPT_NODE].inputs.text = negPrompt.text;");
      code.push("      }");
      code.push("      ");
    }
    
    // Modify sampler params
    if (analysis.samplerNodes.length > 0) {
      code.push("      // Set sampler parameters");
      code.push("      if (SAMPLER_NODE && wf[SAMPLER_NODE]) {");
      if (analysis.samplerNodes[0].samplers) {
        code.push("        wf[SAMPLER_NODE].inputs.sampler_name = ddSampler.selection.text;");
      }
      if (analysis.samplerNodes[0].schedulers) {
        code.push("        wf[SAMPLER_NODE].inputs.scheduler = ddScheduler.selection.text;");
      }
      if (analysis.samplerNodes[0].stepsRange) {
        code.push("        wf[SAMPLER_NODE].inputs.steps = parseInt(stepsVal.text);");
      }
      if (analysis.samplerNodes[0].cfgRange) {
        code.push("        wf[SAMPLER_NODE].inputs.cfg = parseFloat(cfgVal.text);");
      }
      if (analysis.samplerNodes[0].denoiseRange) {
        code.push("        wf[SAMPLER_NODE].inputs.denoise = parseFloat(denVal.text);");
      }
      code.push("        wf[SAMPLER_NODE].inputs.seed = Math.floor(Math.random() * 0xFFFFFFFF);");
      code.push("      }");
      code.push("      ");
    }
    
    // Modify LoRA strengths
    if (analysis.loraNodes.length > 0) {
      code.push("      // Set LoRA strengths");
      for (var i = 0; i < analysis.loraNodes.length; i++) {
        var loraVarPrefix = "lora" + (i + 1);
        code.push("      if (wf[LORA_NODES[" + i + "]]) {");
        code.push("        wf[LORA_NODES[" + i + "]].inputs.strength_model = parseFloat(" + loraVarPrefix + "ModelVal.text);");
        code.push("        wf[LORA_NODES[" + i + "]].inputs.strength_clip = parseFloat(" + loraVarPrefix + "ClipVal.text);");
        code.push("      }");
      }
      code.push("      ");
    }
    
    // Modify size
    if (analysis.sizeNodes.length > 0) {
      code.push("      // Set size");
      code.push("      if (SIZE_NODE && wf[SIZE_NODE]) {");
      code.push("        var comp = app.project.activeItem;");
      code.push("        if (useComp.value && comp && comp instanceof CompItem) {");
      code.push("          wf[SIZE_NODE].inputs.width = comp.width;");
      code.push("          wf[SIZE_NODE].inputs.height = comp.height;");
      code.push("        }");
      code.push("      }");
      code.push("      ");
    }
    
    code.push("      // TODO: Send to ComfyUI (implement HTTP functions)");
    code.push("      alert(\"Panel generated!\\n\\nWorkflow modified successfully.\\n\\nImplement HTTP sending to complete.\");");
    code.push("      statusTxt.text = \"Ready\";");
    code.push("      ");
    code.push("    } catch(e) {");
    code.push("      alert(\"Error: \" + e);");
    code.push("      statusTxt.text = \"Error\";");
    code.push("    }");
    code.push("  };");
    code.push("  ");
    
    // Show window
    code.push("  if (win instanceof Window) { ");
    code.push("    win.center(); ");
    code.push("    win.show();");
    code.push("  } else { ");
    code.push("    win.layout.layout(true);");
    code.push("    win.layout.resize();");
    code.push("  }");
    code.push("  ");
    code.push("})(this);");
    
    return code.join("\n");
  }
  
  // ====== MAIN GENERATOR FUNCTION ======
  function generatePanel() {
    log("=== ComfyUI Panel Generator Started ===");
    
    // 1. User selects workflow file
    var wfFile = File.openDialog("Select ComfyUI workflow JSON");
    if (!wfFile) {
      log("User cancelled workflow selection");
      return;
    }
    
    log("Selected workflow: " + wfFile.fsName);
    
    // 2. Load and parse workflow
    if (!wfFile.open("r")) die("Cannot open workflow file");
    var wfText = wfFile.read();
    wfFile.close();
    
    var workflow;
    try {
      workflow = JSON.parse(wfText);
    } catch(e) {
      die("Invalid JSON in workflow file", e.toString());
    }
    
    log("Workflow parsed successfully");
    
    // 3. Ask for ComfyUI connection
    var host = prompt("ComfyUI host:", DEFAULT_HOST) || DEFAULT_HOST;
    var port = prompt("ComfyUI port:", DEFAULT_PORT) || DEFAULT_PORT;
    
    log("Connecting to ComfyUI at " + host + ":" + port);
    
    // 4. Fetch API info
    var objectInfo = httpGetObjectInfo(host, port);
    if (!objectInfo) {
      if (!confirm("Cannot connect to ComfyUI at " + host + ":" + port + "\n\nContinue anyway? (Panel will have limited functionality)")) {
        return;
      }
      log("Continuing without API info");
    } else {
      log("Got object_info from ComfyUI");
    }
    
    // 5. Analyze workflow
    var analysis = analyzeWorkflow(workflow, objectInfo);
    
    // 6. Generate panel code
    var workflowName = wfFile.name.replace(/\.json$/i, "");
    var panelCode = buildPanelCode(workflowName, workflow, analysis, host, port);
    
    log("Panel code generated (" + panelCode.length + " bytes)");
    
    // 7. Save to ScriptUI Panels folder
    var panelFileName = "ComfyUI_" + workflowName + ".jsx";
    var panelFile = new File(Folder.appPackage.fsName + "/Scripts/ScriptUI Panels/" + panelFileName);
    
    log("Target panel file: " + panelFile.fsName);
    
    if (panelFile.exists) {
      if (!confirm("Panel '" + panelFileName + "' already exists.\n\nOverwrite?")) {
        log("User cancelled overwrite");
        return;
      }
    }
    
    if (!panelFile.open("w")) {
      die("Cannot create panel file", panelFile.fsName);
    }
    
    panelFile.write(panelCode);
    panelFile.close();
    
    log("Panel saved successfully");
    log("=== Panel Generation Complete ===");
    
    alert("Panel generated successfully!\n\n" +
          "File: " + panelFileName + "\n" +
          "Location: " + panelFile.fsName + "\n\n" +
          "RESTART After Effects to use the new panel.\n\n" +
          "It will appear in:\nWindow > " + panelFileName.replace(/\.jsx$/, ""));
  }
  
  // Run generator
  generatePanel();
  
})();
