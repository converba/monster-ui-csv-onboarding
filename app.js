define(function(require) {
	var $ = require('jquery'),
		_ = require('lodash'),
		monster = require('monster'),
		Papa = require('papaparse');

	var app = {
		css: [ 'app' ],

		i18n: {
			'de-DE': { customCss: false },
			'en-US': { customCss: false }
		},

		appFlags: {
			csvOnboarding: {
				columns: {
					mandatory: ['first_name', 'last_name', 'email', 'extension', 'mac_address', 'brand', 'family', 'model']
				},
				users: {
					smartPBXCallflowString: ' SmartPBX\'s Callflow',
					smartPBXVMBoxString: '\'s VMBox'
				}
			}
		},

		requests: {},

		subscribe: {},

		load: function(callback) {
			var self = this;

			self.initApp(function() {
				callback && callback(self);
			});
		},

		initApp: function(callback) {
			var self = this;

			monster.pub('auth.initApp', {
				app: self,
				callback: callback
			});
		},

		// Entry Point of the app
		render: function(container) {
			var self = this;

			monster.ui.generateAppLayout(self, {
				menus: [
					{
						tabs: [
							{
								text: self.i18n.active().csvOnboarding.title,
								callback: self.csvOnboardingRender
							}
						]
					}
				]
			});
		},

		csvOnboardingRender: function(pArgs) {
			var self = this,
				args = pArgs || {},
				container = args.container || $('#csv_onboarding_app_container .app-content-wrapper'),
				mainTemplate = $(self.getTemplate({ name: 'layout' }));

			self.uploadsRender(mainTemplate);

			container
				.fadeOut(function() {
					$(this)
						.empty()
						.append(mainTemplate)
						.fadeIn();
				});
		},

		uploadsRender: function(container) {
			var self = this,
				template = $(self.getTemplate({ name: 'upload' }));

			self.bindUploadEvents(template);

			container.find('.content-wrapper')
						.empty()
						.append(template);
		},

		bindUploadEvents: function(template) {
			var self = this,
				file,
				handleFileSelect = function(evt) {
					file = evt.target.files[0];
					onFileSelected(file);
				},
				onFileSelected = function(file) {
					var isValid = file.name.match('.+(.csv)$');

					if (isValid) {
						template.find('.file-name').text(file.name);
						template.find('.selected-file').show();
						template.find('.upload-frame').hide();
						template.find('.start-job-action').removeAttr('disabled');
					} else {
						var text = self.getTemplate({
							name: '!' + self.i18n.active().csvOnboarding.uploads.errors.wrongType,
							data: {
								type: file.type
							}
						});

						monster.ui.alert('error', text);

						onInvalidFile();
					}
				},
				onInvalidFile = function() {
					file = undefined;
					template.find('.start-job-action').attr('disabled', 'disabled');
				},
				addJob = function() {
					if (file) {
						Papa.parse(file, {
							header: true,
							skipEmptyLines: true,
							complete: function(results) {
								var formattedData = {
									fileName: file.name,
									records: results.data,
									columns: {
										expected: {
											mandatory: self.appFlags.csvOnboarding.columns.mandatory,
											optional: ['password']
										},
										actual: results.meta.fields
									}
								};

								self.renderReview(formattedData);
							}
						});
					}
				};

			//template.find('#upload_csv_file').change(handleFileSelect);
			template.find('#upload_csv_file').on('change', function(e) {
				handleFileSelect(e);
			});

			template.find('#proceed').on('click', function() {
				addJob();
			});

			template.find('.text-upload').on('click', function() {
				template.find('#upload_csv_file').trigger('click');
			});

			template.find('.undo-upload').on('click', function(e) {
				template.find('.file-name').text('');
				template.find('.selected-file').hide();
				template.find('.upload-frame').show();
				onInvalidFile();

				e.stopPropagation();
			});

			var container = template.find('.upload-frame').get(0);

			container.ondragover = function(e) {
				template.find('.upload-frame').addClass('hover');
				return false;
			};
			container.ondragleave = function(e) {
				template.find('.upload-frame').removeClass('hover');
				return false;
			};
			container.ondrop = function(e) {
				template.find('.upload-frame').removeClass('hover');
				e.preventDefault();

				file = e.dataTransfer.files[0];
				onFileSelected(file);
				return false;
			};
		},

		renderReview: function(data) {
			var self = this,
				parent = $('#csv_onboarding_app_container'),
				templateData = self.prepareReviewData(data),
				template = $(self.getTemplate({
					name: 'review',
					data: templateData
				}));

			self.bindReview(template, data);

			parent.find('.content-wrapper')
					.empty()
					.append(template);
		},

		bindReview: function(template, data) {
			var self = this,
				expectedColumns = data.columns.expected;

			monster.ui.footable(template.find('.footable'), {
				filtering: {
					enabled: false
				}
			});

			template.find('#proceed').on('click', function() {
				var columnsMatching = self.getColumnsMatching(template),
					resultCheck = self.checkValidColumns(columnsMatching, expectedColumns);

				if (resultCheck.isValid) {
					var formattedData = self.formatTaskData(columnsMatching, data),
						hasCustomizations = template.find('.has-customizations').prop('checked');

					if (hasCustomizations) {
						self.renderCustomizations(formattedData.data, function(customizations) {
							self.startProcess(formattedData.data, customizations);
						});
					} else {
						self.startProcess(formattedData.data, {});
					}
				} else {
					var msg = self.i18n.active().csvOnboarding.review.errors.title + '<br/><br/>';

					_.each(resultCheck.errors, function(v, category) {
						_.each(v, function(column) {
							msg += column + ': ' + self.i18n.active().csvOnboarding.review.errors[category] + '<br/>';
						});
					});

					monster.ui.alert('error', msg);
				}
			});

			template.find('#cancel').on('click', function() {
				self.csvOnboardingRender();
			});
		},

		createSmartPBXData: function(formattedData, customizations, onProgress) {
			var self = this,
				parallelRequests = [],
				totalRequests,
				countFinishedRequests = 0,
				dataProgress;

			_.each(formattedData, function(record) {
				parallelRequests.push(function(callback) {
					var data = self.formatUserData(record, customizations);

					self.createSmartPBXUser(data, function(dataUser) {
						dataProgress = {
							countFinishedRequests: countFinishedRequests++,
							totalRequests: totalRequests
						};
						onProgress(dataUser, dataProgress);

						callback && callback(null, dataUser);
					});
				});
			});

			totalRequests = parallelRequests.length;

			monster.parallel(parallelRequests, function(err, results) {
				self.showResults(results);
			});
		},

		startProcess: function(data, customizations) {
			var self = this,
				template = $(self.getTemplate({
					name: 'progress',
					data: {
						totalRequests: data.length
					}
				}));

			$('#csv_onboarding_app_container').find('.content-wrapper')
					.empty()
					.append(template);

			self.createSmartPBXData(data, customizations, function(user, progress) {
				var percentFilled = Math.ceil((progress.countFinishedRequests / progress.totalRequests) * 100);
				template.find('.count-requests-done').html(progress.countFinishedRequests);
				template.find('.count-requests-total').html(progress.totalRequests);
				template.find('.inner-progress-bar').attr('style', 'width: ' + percentFilled + '%');
			});
		},

		renderCustomizations: function(data, onContinue) {
			var self = this,
				parent = $('#csv_onboarding_app_container'),
				template = $(self.getTemplate({
					name: 'customizations'
				})),
				getJson = function(str) {
					try {
						return JSON.parse(str);
					} catch (e) {
						return {};
					}
				};

			template.find('textarea').on('keyup', function() {
				var $this = $(this),
					val = $this.val(),
					jsonValue = getJson(val);

				if (!_.isEmpty(jsonValue)) {
					$this.siblings('.json-result').empty();
					monster.ui.renderJSON(jsonValue, $this.siblings('.json-result'));
				}
			});

			template.find('.continue').on('click', function() {
				var customizations = {
					user: getJson(template.find('textarea[data-type="user"]').val()),
					device: getJson(template.find('textarea[data-type="device"]').val()),
					vmbox: getJson(template.find('textarea[data-type="vmbox"]').val())
				};

				onContinue && onContinue(customizations);
			});

			parent.find('.content-wrapper')
					.empty()
					.append(template);
		},

		showResults: function(results) {
			var self = this;
			/*var self = this,
				parent = $('#csv_onboarding_app_container'),
				template = $(self.getTemplate({
					name: 'results',
					data: results
				}));

			monster.ui.footable(template.find('.footable'));

			parent.find('.content-wrapper')
					.empty()
					.append(template);*/

			/*{
				provision: {
					combo_keys: {
						0: {type: "line"},
						1: {type: "parking", value: "1"},
						2: {type: "parking", value: "2"}
					}
				}
			}*/
			monster.ui.toast({
				type: 'success',
				message: 'Congratulations, you successfully imported data to this account!'
			});

			self.csvOnboardingRender();
		},

		formatTaskData: function(columnsMatching, data) {
			var self = this,
				formattedRecords = [],
				formattedElement,
				formattedData = {
					fileName: data.fileName
				};

			_.each(data.records, function(record) {
				formattedElement = {};

				_.each(columnsMatching, function(backendColumn, frontendColumn) {
					if (backendColumn !== '_none') {
						formattedElement[backendColumn] = record[frontendColumn];
					}
				});

				formattedRecords.push(formattedElement);
			});

			formattedData.data = formattedRecords;

			return formattedData;
		},

		getColumnsMatching: function(template) {
			var self = this,
				mappings = {},
				$this;

			template.find('.review-table-wrapper tr.footable-header th.column-data').each(function() {
				$this = $(this);
				mappings[$this.data('column')] = $this.find('.column-selector').val();
			});

			return mappings;
		},

		checkValidColumns: function(columns, requiredColumns) {
			var self = this,
				mapColumns = {
					mandatory: {},
					optional: {}
				},
				isValid = true,
				errors = {
					missing: [],
					tooMany: []
				};

			_.each(requiredColumns, function(category, categoryName) {
				mapColumns[categoryName] = {};

				_.each(category, function(column) {
					mapColumns[categoryName][column] = 0;
				});
			});

			_.each(columns, function(column) {
				if (mapColumns.mandatory.hasOwnProperty(column)) {
					mapColumns.mandatory[column]++;
				}

				if (mapColumns.optional.hasOwnProperty(column)) {
					mapColumns.optional[column]++;
				}
			});

			_.each(mapColumns.mandatory, function(count, column) {
				if (count !== 1) {
					errors[count === 0 ? 'missing' : 'tooMany'].push(column);

					isValid = false;
				}
			});

			_.each(mapColumns.optional, function(count, column) {
				if (count > 1) {
					errors.tooMany.push(column);

					isValid = false;
				}
			});

			return {
				isValid: isValid,
				errors: errors
			};
		},

		prepareReviewData: function(data) {
			var formattedData = {
				data: {
					fileName: data.fileName,
					totalRecords: data.records.length,
					columns: {
						actual: data.columns.actual,
						expected: data.columns.expected
					},
					recordsToReview: data.records.slice(0, 5)
				}
			};

			// remove extra data not parsed properly
			_.each(formattedData.data.recordsToReview, function(record) {
				delete record.__parsed_extra;
			});

			formattedData.data.columns.others = [];

			var occurences;

			// for each column in the csv, we check if it's one of the column mandatory or optional in that job.
			// If not, then we add it to the list of 'Others' columns to choose from
			// This was added so users can submit their extra column they need to keep in the database, such as billing ids etc...
			_.each(data.columns.actual, function(actualColumnName) {
				occurences = 0;
				_.each(data.columns.expected, function(expectedColumnGrp) {
					if (expectedColumnGrp && expectedColumnGrp.indexOf(actualColumnName) >= 0) {
						occurences++;
					}
				});

				if (occurences === 0 && formattedData.data.columns.others.indexOf(actualColumnName) < 0) {
					formattedData.data.columns.others.push(actualColumnName);
				}
			});

			return formattedData;
		},

		createSmartPBXUser: function(data, success, error) {
			var self = this,
				formattedResult = {
					device: {},
					user: {},
					vmbox: {},
					callflow: {}
				};

			self.callApi({
				resource: 'user.create',
				data: {
					accountId: self.accountId,
					data: data.user
				},
				success: function(_dataUser) {
					formattedResult.user = _dataUser.data;

					var userId = _dataUser.data.id;
					data.user.id = userId;
					data.vmbox.owner_id = userId;
					data.device.owner_id = userId;

					monster.parallel({
						vmbox: function(callback) {
							self.createVMBox(data.vmbox, function(_dataVM) {
								callback(null, _dataVM);
							});
						},
						device: function(callback) {
							self.createDevice(data.device, function(_dataDevice) {
								callback(null, _dataDevice);
							});
						}
					}, function(err, results) {
						formattedResult.vmbox = results.vmbox;
						formattedResult.device = results.device;

						data.callflow.owner_id = userId;
						data.callflow.type = 'mainUserCallflow';
						data.callflow.flow.data.id = userId;
						data.callflow.flow.children._.data.id = results.vmbox.id;

						self.createCallflow(data.callflow, function(_dataCF) {
							formattedResult.callflow = _dataCF;

							success(formattedResult);
						});
					});
				},
				error: function() {
					error();
				}
			});
		},

		createVMBox: function(data, callback) {
			var self = this;

			self.callApi({
				resource: 'voicemail.create',
				data: {
					accountId: self.accountId,
					data: data
				},
				success: function(data) {
					callback(data.data);
				}
			});
		},

		createCallflow: function(data, callback) {
			var self = this;

			self.callApi({
				resource: 'callflow.create',
				data: {
					accountId: self.accountId,
					data: data
				},
				success: function(data) {
					callback(data.data);
				}
			});
		},

		createDevice: function(data, callback) {
			var self = this;

			self.callApi({
				resource: 'device.create',
				data: {
					accountId: self.accountId,
					data: data
				},
				success: function(data) {
					callback(data.data);
				}
			});
		},

		formatUserData: function(data, customizations) {
			var self = this,
				fullName = data.first_name + ' ' + data.last_name,
				callerIdName = fullName.substring(0, 15),
				formattedData = {
					rawData: data,
					user: $.extend(true, {}, customizations.user, {
						first_name: data.first_name,
						last_name: data.last_name,
						username: data.email,
						password: (data.password && typeof data.password !== 'undefined')?data.password:monster.util.randomString(12),
						caller_id: {
							internal: {
								name: callerIdName,
								number: data.extension
							}
						},
						presence_id: data.extension,
						email: data.email
					}),
					device: $.extend(true, {}, customizations.device, {
						device_type: 'sip_device',
						enabled: true,
						mac_address: data.mac_address,
						name: data.first_name + ' ' + data.last_name + ' - ' + data.brand + ' ' + data.model,
						provision: {
							endpoint_brand: data.brand,
							endpoint_family: data.family,
							endpoint_model: data.model
						},
						sip: {
							password: monster.util.randomString(12),
							username: 'user_' + monster.util.randomString(10)
						}
					}),
					vmbox: $.extend(true, {}, customizations.vmbox, {
						mailbox: data.extension,
						name: fullName + self.appFlags.csvOnboarding.users.smartPBXVMBoxString
					}),
					callflow: {
						contact_list: {
							exclude: false
						},
						flow: {
							children: {
								_: {
									children: {},
									data: {},
									module: 'voicemail'
								}
							},
							data: {
								can_call_self: false,
								timeout: 20
							},
							module: 'user'
						},
						name: fullName + self.appFlags.csvOnboarding.users.smartPBXCallflowString,
						numbers: [ data.extension ]
					}
				};

			return formattedData;
		}
	};

	return app;
});
