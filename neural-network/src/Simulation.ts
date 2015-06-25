///<reference path='../lib/typings/jquery/jquery.d.ts' />
///<reference path='../lib/typings/jquery-handsontable/jquery-handsontable.d.ts' />
///<reference path='Net.ts' />
///<reference path='NetworkGraph.ts' />
///<reference path='NetworkVisualization.ts' />
///<reference path='Presets.ts' />
interface JQuery { slider: any };

class TableEditor {
	hot: any;
	constructor(public container: JQuery, public config: Configuration) {
		container.handsontable({
			minSpareRows: 1,
			cells: (row, col, prop) => {
				if (row > 0) return { type: 'numeric', format: '0.[000]' };
			},
			customBorders: true,
			allowInvalid: false,
			afterChange: this.afterChange.bind(this)
		});
		this.hot = container.handsontable('getInstance');
		this.loadData();
	}
	afterChange(changes:[number,number,number,number][], reason:string) {
		if(reason === 'loadData') return;
		this.reparseData();
	}
	reparseData() {
		let data: number[][] = this.hot.getData();
		let inputCount = this.config.inputLayer.neuronCount;
		this.config.data = data.filter(row => row.every(cell => typeof cell === 'number'))
			.map(row => <TrainingData>{ input: row.slice(0, inputCount), output: row.slice(inputCount) });
	}
	loadData() {
		let data: (number|string)[][] = [this.config.inputLayer.names.concat(this.config.outputLayer.names)];
		this.config.data.forEach(t => data.push(t.input.concat(t.output)));
		this.hot.loadData(data);
		this.hot.updateSettings({customBorders: [
				{
					range: {
						from: { row: 0, col: this.config.inputLayer.neuronCount },
						to: { row: 100, col: this.config.inputLayer.neuronCount }
					},
					left: { width: 2, color: 'black' }
				}
			]});
		this.hot.render();
	}
}
class NeuronGui {
	layerDiv: JQuery = $("#hiddenLayersModify > div").clone();

	removeLayer() {
		$("#hiddenLayersModify > div").eq(0).remove();
	}
	addLayer() {
		$("#hiddenLayersModify > div").eq(0).before(this.layerDiv.clone());
	}
	setActivation(layer: int, activ: string) {
		
	}
	constructor(public sim: Simulation) {
		$("#hiddenLayersModify").on("click", "button", e => {
			let inc = e.target.textContent == '+';
			let layer = $(e.target.parentNode).index();
			let newval = sim.config.hiddenLayers[layer].neuronCount + (inc ? 1 : -1);
			if (newval < 1) return;
			sim.config.hiddenLayers[layer].neuronCount = newval;
			$("#hiddenLayersModify .neuronCount").eq(layer).text(newval);
			sim.initializeNet();
		});
		$("#inputLayerModify,#outputLayerModify").on("click", "button", e => {
			let isInput = $(e.target).closest("#inputLayerModify").length > 0;
			let name = isInput?"input":"output";
			let targetLayer = isInput ? sim.config.inputLayer : sim.config.outputLayer;
			let inc = e.target.textContent == '+';
			let newval = targetLayer.neuronCount + (inc ? 1 : -1);
			if (newval < 1) return;
			targetLayer.neuronCount = newval;
			$(`#${name}LayerModify .neuronCount`).text(newval);
			targetLayer.names = [];
			for(let i = 0; i < newval; i++)
				targetLayer.names.push(`${name} ${i+1}`);
			sim.config.data = [];
			sim.initializeNet();
		});
		$("#layerCountModifier").on("click", "button", e => {
			let inc = e.target.textContent == '+';
			if (!inc) {
				if (sim.config.hiddenLayers.length == 0) return;
				sim.config.hiddenLayers.shift();
				this.removeLayer();
			} else {
				sim.config.hiddenLayers.unshift({ activation: 'sigmoid', neuronCount: 2 });
				this.addLayer();
			}
			$("#layerCount").text(sim.config.hiddenLayers.length + 2);
			sim.initializeNet();
		});
		$("#outputLayerModify").on("change","select" ,e=> {
			sim.config.outputLayer.activation = (<any>e.target).value;
			sim.initializeNet();
		});
		$("#hiddenLayersModify").on("change","select" ,e=> {
			let layer = $(e.target.parentNode).index();
			sim.config.hiddenLayers[layer].activation = (<HTMLSelectElement>e.target).value;
			sim.initializeNet();
		});
	}
	regenerate() {
		let targetCount = this.sim.config.hiddenLayers.length;
		while ($("#hiddenLayersModify > div").length > targetCount)
			this.removeLayer();
		while ($("#hiddenLayersModify > div").length < targetCount)
			this.addLayer();
		this.sim.config.hiddenLayers.forEach(
			(c: LayerConfig, i: int) => {
				$("#hiddenLayersModify .neuronCount").eq(i).text(c.neuronCount);
				$("#hiddenLayersModify > div").eq(i).children("select.activation").val(c.activation);
			});
	}
}
interface InputLayerConfig {
	neuronCount: int;
	names: string[];
}
interface LayerConfig {
	neuronCount: int;
	activation: string;
}
interface OutputLayerConfig extends LayerConfig {
	names: string[];
}
class Simulation {
	netviz: NetworkVisualization;
	netgraph: NetworkGraph;
	backgroundResolution = 10;
	stepNum = 0;
	running = false; runningId = -1;
	restartTimeout = -1;

	net: Net.NeuralNet;
	neuronGui: NeuronGui;
	table: TableEditor;
	config = Presets.get('XOR');

	constructor() {
		let canvas = <HTMLCanvasElement>$("#neuralInputOutput canvas")[0];
		this.netviz = new NetworkVisualization(canvas,
			new CanvasMouseNavigation(canvas, () => this.netviz.inputMode == 3, () => this.draw()),
			this,
			(x, y) => this.net.getOutput([x, y])[0],
			this.backgroundResolution);
		this.netgraph = new NetworkGraph($("#neuralNetworkGraph")[0]);
		(<any>$("#learningRate")).slider({
			min: 0.01, max: 1, step: 0.005, scale: "logarithmic", value: 0.05
		}).on('change', (e: any) => $("#learningRateVal").text(e.value.newValue.toFixed(3)));
		this.neuronGui = new NeuronGui(this);
		for (let name of Presets.getNames())
			$("#presetLoader").append($("<li>").append($("<a>").text(name)));
		$("#presetLoader").on("click", "a", e => {
			let name = e.target.textContent;
			this.config = Presets.get(name);
			this.setConfig();
			this.initializeNet();
		});

		this.table = new TableEditor($("<div class='fullsize'>"), this.config);
		$("#dataInputSwitch").on("click", "a", e => {
			$("#dataInputSwitch li.active").removeClass("active");
			let li = $(e.target).parent();
			li.addClass("active");
			let mode = li.index();
			if (this.netviz.inputMode == mode) return;
			this.netviz.inputMode = mode;
			if (mode == InputMode.Table) {
				$("#neuralInputOutput > *").replaceWith(this.table.container);
				this.table.loadData();
			} else {
				this.table.reparseData();
				$("#neuralInputOutput > *").replaceWith(this.netviz.canvas);
				this.draw();
			}
		});
		this.reset();
		this.run();
	}

	initializeNet(weights?: double[]) {
		if (this.net) this.stop();
		this.net = new Net.NeuralNet(this.config.inputLayer, this.config.hiddenLayers, this.config.outputLayer, this.config.learningRate, this.config.bias, undefined, weights);
		let isBinClass = this.config.outputLayer.neuronCount === 1;
		$("#dataInputSwitch > li").eq(1).toggle(isBinClass);
		let firstButton = $("#dataInputSwitch > li > a").eq(0);
		firstButton.text(isBinClass ? "Add Red" : "Add point")
		if (this.netviz.inputMode != InputMode.Table) firstButton.click();
		console.log("net:" + JSON.stringify(this.net.connections.map(c => c.weight)));
		this.stepNum = 0;
		this.netgraph.loadNetwork(this.net);
		this.table.loadData();
		this.draw();
		this.updateStatusLine();
	}
	statusIterEle = document.getElementById('statusIteration');
	statusCorrectEle = document.getElementById('statusCorrect');
	step() {
		this.stepNum++;
		for (let val of this.config.data) {
			this.net.train(val.input, val.output);
		}
	}

	draw() {
		this.netviz.draw();
		this.netgraph.update();
	}

	run() {
		if (this.running) return;
		$("#runButton").text("Stop").addClass("btn-danger").removeClass("btn-primary");
		this.running = true;
		this.animationStep();
	}

	stop() {
		clearTimeout(this.restartTimeout);
		$("#runButton").text("Run").addClass("btn-primary").removeClass("btn-danger");
		this.restartTimeout = -1;
		this.running = false;
		cancelAnimationFrame(this.runningId);
	}

	reset() {
		this.stop();
		this.loadConfig();
		this.initializeNet();
	}

	updateStatusLine() {
		let correct = 0;
		if(this.config.outputLayer.neuronCount === 1) {
			for (var val of this.config.data) {
				let res = this.net.getOutput(val.input);
				if (+(res[0] > 0.5) == val.output[0]) correct++;
			}
			this.statusCorrectEle.innerHTML = `Correct: ${correct}/${this.config.data.length}`;
		} else {
			let sum = 0;
			for(let val of this.config.data) {
				let res = this.net.getOutput(val.input);
				let sum1 = 0;
				for(let i = 0; i < this.net.outputs.length; i++) {
					let dist = res[i] - val.output[i];
					sum1 += dist * dist;
				}
				sum += Math.sqrt(sum1);
			}
			this.statusCorrectEle.innerHTML = `Avg. distance: ${(sum/this.config.data.length).toFixed(2) }`;
		}

		this.statusIterEle.innerHTML = this.stepNum.toString();

		if (correct == this.config.data.length) {
			if (this.config.autoRestart && this.running && this.restartTimeout == -1) {
				this.restartTimeout = setTimeout(() => {
					this.stop();
					this.restartTimeout = -1;
					setTimeout(() => { this.reset(); this.run(); }, 1000);
				}, this.config.autoRestartTime - 1);
			}
		} else {
			if (this.restartTimeout != -1) {
				clearTimeout(this.restartTimeout);
				this.restartTimeout = -1;
			}
		}
	}

	aniFrameCallback = this.animationStep.bind(this);
	animationStep() {
		for (let i = 0; i < this.config.stepsPerFrame; i++) this.step();
		this.draw();
		this.updateStatusLine();
		if (this.running) this.runningId = requestAnimationFrame(this.aniFrameCallback);
	}

	iterations() {
		this.stop();
		for (var i = 0; i < this.config.iterationsPerClick; i++)
			this.step();
		this.draw();
		this.updateStatusLine();
	}

	loadConfig() { // from gui
		let config = <any>this.config;
		let oldConfig = $.extend({}, config);
		for (let conf in config) {
			let ele = <HTMLInputElement>document.getElementById(conf);
			if (!ele) continue;
			if (ele.type == 'checkbox') config[conf] = ele.checked;
			else if (typeof config[conf] === 'number')
				config[conf] = +ele.value;
			else config[conf] = ele.value;
		}
		if (oldConfig.simType != config.simType) config.data = [];
		if (this.net) this.net.learnRate = this.config.learningRate;
	}
	setConfig() { // in gui
		let config = <any>this.config;
		for (let conf in config) {
			let ele = <HTMLInputElement>document.getElementById(conf);
			if (!ele) continue;
			if (ele.type == 'checkbox') ele.checked = config[conf];
			else ele.value = config[conf];
		}
		$("#learningRate").slider('setValue', this.config.learningRate);
		$("#learningRateVal").text(this.config.learningRate.toFixed(3));
		this.neuronGui.regenerate();
	}

	runtoggle() {
		if (this.running) this.stop();
		else this.run();
	}
}