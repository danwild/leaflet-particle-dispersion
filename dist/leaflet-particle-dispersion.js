'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

(function (factory, window) {

	// AMD
	if (typeof define === 'function' && define.amd) {
		define(['leaflet', 'leaflet.heat', 'chroma-js'], factory);

		// Common JS
	} else if ((typeof exports === 'undefined' ? 'undefined' : _typeof(exports)) === 'object') {
		module.exports = factory(require('leaflet'), require('leaflet.heat'), require('chroma-js'));
	}

	// Global
	if (typeof window !== 'undefined' && window.L && window.L.heatLayer && window.chroma) {
		window.L.particleDispersionLayer = factory(L, window.L.heatLayer, window.chroma);
	}
})(function (L, leafletHeat, chroma) {

	var ParticleDispersionLayer = (L.Layer ? L.Layer : L.Class).extend({

		// particle data indices
		_pidIndex: 0,
		_pLatIndex: 1,
		_pLonIndex: 0,
		_pDepthIndex: 2,
		_pAgeIndex: 3,
		//_pidIndex:    0,
		//_pLatIndex:   1 + 1,
		//_pLonIndex:   0 + 1,
		//_pDepthIndex: 2 + 1,
		//_pAgeIndex:   3 + 1,

		// misc
		_particleLayer: null,
		_frameIndex: 0,
		_markers: [],
		_colors: null,

		/*------------------------------------ LEAFLET SPECIFIC ------------------------------------------*/

		_active: false,
		_map: null,
		// the L.canvas renderer
		_renderer: null,
		// the DOM leaflet-pane that contains html canvas
		_pane: null,

		// user options
		options: {
			data: null,
			displayMode: '',
			startFrameIndex: 0,
			ageColorScale: null,
			ageDomain: null,
			exposureHeatOptions: {},
			finalHeatOptions: {},

			exposureIntensity: 0.9,
			finalIntensity: 0.9
		},

		initialize: function initialize(options) {
			// (L.setOptions was not working as expected)
			this.options = this._extendObject(this.options, options);
		},

		/**
   * Initialise renderer when layer is added to the map / becomes active,
   * and draw circle markers if user has specified the displayMode
   *
   * @param map {Object} Leaflet map
   */
		onAdd: function onAdd(map) {
			this._active = true;
			this._map = map;
			this._createRenderer();
			if (this.options.displayMode) this.setDisplayMode(this.options.displayMode);
		},

		/**
   * Remove the pane from DOM, and void renderer when layer removed from map
   */
		onRemove: function onRemove() {
			this._map.removeLayer(this._particleLayer);
			L.DomUtil.remove(this._pane);
			this._renderer = null;
			this._particleLayer = null;
			this._active = false;
		},


		/*------------------------------------ PUBLIC ------------------------------------------*/

		/**
   * check if the particle layer is currently active on the map
   * @returns {boolean}
   */
		isActive: function isActive() {
			return this._active;
		},


		/**
   * Update the layer with new data
   * @param data
   */
		setData: function setData(data) {
			this.options.data = data;
			this.setDisplayMode(this.options.displayMode);
		},


		/**
   * Set the display mode of the layer
   * @param mode {string} One of: ['FINAL', 'EXPOSURE', 'KEYFRAME']
   */
		setDisplayMode: function setDisplayMode(mode) {

			this.options.displayMode = mode;

			if (!this.isActive()) return;

			switch (this.options.displayMode) {

				case 'EXPOSURE':
					this._initDisplayExposure();
					break;

				case 'FINAL':
					this._initDisplayFinal();
					break;

				case 'KEYFRAME':
					this._initDisplayKeyframe();
					break;

				default:
					console.error('Attempted to initialise with invalid displayMode: ' + this.options.displayMode);
					break;
			}
		},


		/**
   * Display the particles at the given frame index
   * @param index {number} the keyframe index
   */
		setFrameIndex: function setFrameIndex(index) {

			if (!this.isActive()) return;
			var self = this;
			self._frameIndex = index;

			var keys = Object.keys(self.options.data);
			var frame = self.options.data[keys[index]];

			// there's no addLayer*s* function, either need to add each
			// L.circleMarker individually, or reinit the entire layer
			if (self._particleLayer) self._particleLayer.clearLayers();

			for (var i = 0; i < frame.length; i++) {

				var particle = frame[i];
				var pos = self._map.wrapLatLng([particle[self._pLatIndex], particle[self._pLonIndex]]);
				var marker = L.circleMarker(pos, {
					renderer: self._renderer,
					stroke: false,
					fillOpacity: 0.3,
					radius: 8,
					fillColor: this._colors(particle[self._pAgeIndex]).hex(),
					_feature: particle

				});

				self._markers.push(marker);
				self._particleLayer.addLayer(marker);
			}
		},


		/*------------------------------------ PRIVATE ------------------------------------------*/

		/**
   * Create the L.canvas renderer and custom pane to display particles
   * @private
   */
		_createRenderer: function _createRenderer() {
			// create separate pane for canvas renderer
			this._pane = this._map.createPane('particle-dispersion');
			this._renderer = L.canvas({ pane: 'particle-dispersion' });
		},


		/**
   * Remove the particle layer from the map and clear our reference
   * @private
   */
		_clearDisplay: function _clearDisplay() {
			if (this._particleLayer) this._map.removeLayer(this._particleLayer);
			this._particleLayer = null;
		},


		/**
   * @summary Create a chroma-js color scale with user settings or auto scaled to keyframe range
   * @returns {Object} chromaJs color object
   * @private
   */
		_createColors: function _createColors() {
			if (!this.options.ageDomain) this.options.ageDomain = [0, Object.keys(this.options.data).length];
			this._colors = chroma.scale(this.options.ageColorScale).domain(this.options.ageDomain);
			return this._colors;
		},


		/**
   * Create the display layer (heatmap) for FINAL distribution.
   * @private
   */
		_initDisplayFinal: function _initDisplayFinal() {

			this._clearDisplay();

			if (this.options.data) {
				this._createColors();
				var finalData = this._createFinalData();
				this._particleLayer = L.heatLayer(finalData, this.options.finalHeatOptions);
				this._particleLayer.addTo(this._map);
			}
		},


		/**
   * Process data into expected leaflet.heat format,
   * plotting only particles at their end of life
   * [ [lat, lon, intensity], ... ]
   * @private
   */
		_createFinalData: function _createFinalData() {
			var _this = this;

			var finalData = [];

			// get keys, moving forward in time
			var keys = Object.keys(this.options.data);
			keys.sort(function (a, b) {
				return new Date(a) - new Date(b);
			});

			// flatten the data
			var snapshots = [];
			keys.forEach(function (key) {
				snapshots = snapshots.concat(_this.options.data[key]);
			});

			// get an array of uniq particles
			var uids = [];
			snapshots.forEach(function (snapshot) {
				if (uids.indexOf(snapshot[_this._pidIndex]) === -1) uids.push(snapshot[_this._pidIndex]);
			});

			// step backwards from the end of the sim collecting
			// final snapshots for each uniq particle
			keys.reverse();

			for (var i = 0; i < keys.length; i++) {

				if (uids.length === 0) break;

				// check each particle in the snapshot
				this.options.data[keys[i]].forEach(function (snapshot) {

					// if not recorded
					var index = uids.indexOf(snapshot[_this._pidIndex]);
					if (index !== -1) {

						// grab it, and remove it from the list
						finalData.push([snapshot[_this._pLatIndex], snapshot[_this._pLonIndex], _this.options.finalIntensity]);
						uids.splice(index, 1);
					}
				});
			}

			return finalData;
		},


		/**
   * Process data into expected leaflet.heat format,
   * plotting all particles for every snapshot
   * [ [lat, lon, intensity], ... ]
   * @private
   */
		_createExposureData: function _createExposureData() {
			var _this2 = this;

			var exposureData = [];
			var keys = Object.keys(this.options.data);

			keys.forEach(function (key) {
				_this2.options.data[key].forEach(function (particle) {
					exposureData.push([particle[_this2._pLatIndex], // lat
					particle[_this2._pLonIndex], // lon
					_this2.options.exposureIntensity // intensity
					]);
				});
			});

			return exposureData;
		},


		/**
   * Create the display layer (heatmap) for cumulative EXPOSURE
   * @private
   */
		_initDisplayExposure: function _initDisplayExposure() {
			this._clearDisplay();

			if (this.options.data) {
				this._createColors();
				var exposureData = this._createExposureData();
				this._particleLayer = L.heatLayer(exposureData, this.options.exposureHeatOptions);
				this._particleLayer.addTo(this._map);
			}
		},


		/**
   * Create the display layer (L.CircleMarkers) for KEYFRAME's
   * @private
   */
		_initDisplayKeyframe: function _initDisplayKeyframe() {

			this._clearDisplay();

			if (this.options.data) {
				// init the feature group and display first frame
				this._createColors();
				this._particleLayer = L.featureGroup();
				this._markers = [];
				this.setFrameIndex(this._frameIndex);
				this._particleLayer.addTo(this._map);
			} else {
				console.error('Attempted to display keyframes but there is no data.');
			}
		},


		/**
   * Deep merge Objects,
   * Note that destination arrays will be overwritten where they exist in source.
   * @param destination
   * @param source
   * @returns {*}
   */
		_extendObject: function _extendObject(destination, source) {
			var self = this;
			for (var property in source) {
				// .constructor avoids tripping over prototypes etc.
				// don't traverse the data..
				if (property === 'data') {
					destination[property] = source[property];
				} else if (source[property] && source[property].constructor && source[property].constructor === Object) {
					destination[property] = destination[property] || {};
					self._extendObject(destination[property], source[property]);
				} else {
					destination[property] = source[property];
				}
			}
			return destination;
		}
	});

	L.particleDispersionLayer = function (options) {
		return new ParticleDispersionLayer(options);
	};

	return L.particleDispersionLayer;
}, window);