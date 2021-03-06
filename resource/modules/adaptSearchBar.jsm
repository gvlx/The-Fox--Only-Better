/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.1.7

this.__defineGetter__('gSearchBar', function() { return $('searchbar'); });

this.adaptSearchBar = {
	initialized: false,
	placement: null,

	get nonEmptyMode () {
		return this.initialized && Prefs.awesomerURLBar && (Prefs.searchEnginesInURLBar || oneOffSearches.enabled) && Prefs.showOnlyNonEmptySearchBar && this.placement == CustomizableUI.AREA_NAVBAR;
	},

	receiveMessage: function(m) {
		let name = Messenger.messageName(m);

		switch(name) {
			case 'AdaptSearchBar:Value':
				m.target._adaptSearchValue = m.data;
				this.updateSearchBar();
				break;
		}
	},

	handleEvent: function(e) {
		switch(e.type) {
			case 'TabSelect':
				this.updateSearchBar();
				break;

			case 'focus':
				if(!this.nonEmptyMode) { break; }

				switch(e.target) {
					// We don't want to focus the search bar in this case, focus the location bar instead..
					case gSearchBar:
						e.preventDefault();
						e.stopPropagation();
						this.focusURLBar();
						break;

					// Always hide the search bar if the cursor is in the location bar.
					case gURLBar:
						this.maybeHideSearchBar();
						break;
				}
				break;

			case 'blur':
				if(!this.nonEmptyMode) { break; }

				// When bluring the location bar, we should revert its search value back to the current location if the user didn't change it.
				if(!this.maybeHideSearchBar() && (!gURLBar.value || gURLBar.value == gSearchBar.value)) {
					gURLBar.handleRevert();
				}
				break;
		}
	},

	observe: function(aSubject, aTopic, aData) {
		switch(aSubject) {
			case 'showOnlyNonEmptySearchBar':
			case 'searchEnginesInURLBar':
			case 'awesomerURLBar':
				this.toggleShowOnlyNonEmptySearchBar();
				break;
		}
	},

	getSearchPlacement: function() {
		let placement = CustomizableUI.getPlacementOfWidget("search-container");
		this.placement = placement && placement.area;
	},

	onAreaNodeRegistered: function(aArea) {
		// The panel is lazy loaded, so if the search bar is there, this is when we should initialize it.
		if(aArea == CustomizableUI.AREA_PANEL) {
			this.init();
		}
	},

	onWidgetAdded: function(aWidgetId) {
		if(aWidgetId == 'search-container') {
			this.init();
		}
	},

	onWidgetRemoved: function(aWidgetId) {
		if(aWidgetId == 'search-container') {
			this.deinit();
		}
	},

	init: function() {
		if(this.initialized) { return; }

		// this probably means the search bar has been removed by the user in customize mode,
		// our CustomizableUI handlers will reinit this if necessary if it's added back
		if(!gSearchBar) { return; }

		this.initialized = true;
		this.getSearchPlacement();

		Overlays.overlayWindow(window, "adaptSearchBar");

		Listeners.add(gBrowser.tabContainer, 'TabSelect', adaptSearchBar);

		Messenger.listenWindow(window, 'AdaptSearchBar:Value', adaptSearchBar);
		Messenger.loadInWindow(window, 'adaptSearchBar', false);

		Prefs.listen('showOnlyNonEmptySearchBar', this);
		Prefs.listen('searchEnginesInURLBar', this);
		Prefs.listen('awesomerURLBar', this);
		this.toggleShowOnlyNonEmptySearchBar();
	},

	deinit: function() {
		if(!this.initialized) { return; }
		this.initialized = false;

		Timers.cancel('updateSearchBar');

		Prefs.unlisten('showOnlyNonEmptySearchBar', this);
		Prefs.unlisten('searchEnginesInURLBar', this);
		Prefs.unlisten('awesomerURLBar', this);
		this.toggleShowOnlyNonEmptySearchBar(true);

		Messenger.unlistenWindow(window, 'AdaptSearchBar:Value', adaptSearchBar);
		Messenger.unloadFromWindow(window, 'adaptSearchBar');

		Listeners.remove(gBrowser.tabContainer, 'TabSelect', adaptSearchBar);

		Overlays.removeOverlayWindow(window, "adaptSearchBar");

		for(let browser of gBrowser.browsers) {
			delete browser._adaptSearchValue;
		}
	},

	updateSearchBar: function() {
		let searchbar = gSearchBar;

		// This shouldn't happen, but just in case.
		if(!searchbar) {
			this.deinit();
			return;
		}

		// _textbox can be undefined if the binding hasn't taken place yet, can happen with certain combinations of add-ons (it's a strange thing...).
		if(!searchbar._textbox) {
			Timers.init('updateSearchBar', () => {
				this.updateSearchBar();
			}, 50);
			return;
		}

		let browser = gBrowser.mCurrentBrowser;

		// don't change the search bar's value when we're not in a search results page
		if(!this.nonEmptyMode && (browser._adaptSearchValue === undefined || browser._adaptSearchValue === null)) { return; }
		let value = browser._adaptSearchValue || '';

		if(searchbar._textbox.valueIsTyped) {
			// if the typed value is empty or the same as the content filled value, reset the valueIsTyped flag
			if(!searchbar.value || searchbar.value == value) {
				searchbar._textbox.valueIsTyped = false;
			}

			// don't change the value if the user is typing or has typed in the search bar
			if(!this.nonEmptyMode && searchbar.value) { return; }
		}

		// Only change the searchbar's value if the user isn't typing in it.
		if(searchbar.value != value && (!searchbar.value || document.activeElement != searchbar._textbox.inputField)) {
			searchbar.value = value;
		}

		this.maybeHideSearchBar();
	},

	maybeHideSearchBar: function() {
		let hide = this.nonEmptyMode && (document.activeElement == gURLBar.inputField || !gSearchBar.value);
		toggleAttribute(gNavBar, 'hideSearchBar', hide);
		return hide;
	},

	focusURLBar: function() {
		// When the search bar isn't empty (always in this case? unless some add-on triggers this somehow)
		// use its value in the location bar as well
		if(gSearchBar.value) {
			gURLBar.value = gSearchBar.value;
			gURLBar.valueIsTyped = false;
			gURLBar.userTypedValue = null;
		}
		gURLBar.focus();
	},

	toggleShowOnlyNonEmptySearchBar: function(unload) {
		if(!unload && this.nonEmptyMode) {
			Listeners.add(gURLBar, 'focus', this);
			Listeners.add(gURLBar, 'blur', this);
			Listeners.add(gSearchBar, 'focus', this, true);

			Piggyback.add('adaptSearchBar', gSearchBar, 'openSuggestionsPanel', function() {
				// If the search bar is set to be shown only when non-empty, we shouldn't use its suggestions popup.
				// Instead, open the location bar's popup, but only if the location bar isn't already focused.
				if(document.activeElement != gURLBar.inputField) {
					gURLBar.focus();
					gURLBar.showHistoryPopup();
				}
			});

			this.updateSearchBar();
		} else {
			Listeners.remove(gURLBar, 'focus', this);
			Listeners.remove(gURLBar, 'blur', this);

			if(gSearchBar) {
				Listeners.remove(gSearchBar, 'focus', this, true);
				Piggyback.revert('adaptSearchBar', gSearchBar, 'openSuggestionsPanel');
			}

			removeAttribute(gNavBar, 'hideSearchBar');
		}
	}
};

Modules.LOADMODULE = function() {
	CustomizableUI.addListener(adaptSearchBar);

	adaptSearchBar.init();
};

Modules.UNLOADMODULE = function() {
	CustomizableUI.removeListener(adaptSearchBar);

	adaptSearchBar.deinit();
};
