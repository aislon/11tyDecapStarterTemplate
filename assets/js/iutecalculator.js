var EshopCalculator = function(){

    var self = this;

    var ERRORS = {
        "general" : {
            "invalid.period.or.loan.amount" : ["Invalid amount or period for calculations"]
        },
        400: {
            "no.active.agent": ["No active agent"]
        },
        404: ["not.found", "Invalid URL"],
        500: ["internal.error", "Internal error"],
        503: ["service.unavailable", "Service unavailable"]
    };

    var DEFAULT_TEMPLATES = { 'PERIOD_INFORMATION_TEMPLATE': '([monthly-payment] [currency])'};
    var ONE_DAY_IN_MILLISECONDS = 24*60*60*1000;

    this.daysBetween = function(date1, date2) {
        return Math.round(Math.abs((date1.getTime() - date2.getTime())/ONE_DAY_IN_MILLISECONDS));
    };

    this.fetchInputParameters = function(country, currency, url, agentId) {
        this.country = country;
        this.agentId = agentId;
        this.url = url;
        var self = this;
        var response = undefined;
        $.ajax({
            type: "GET",
            async: false,
            contentType: "application/json",
            url: this.url + "/rest/public/e-shop/parameters/multi/1.0/country/" + this.country + "/agent/" + this.agentId,
            success: function (data) {
                if (!data) {
                    return;
                }

                self.debug("Fetched data:");
                self.debug(data);

                response = data;
            },
            error: function (response) {
                self.handleErrors(response);
            }
        })

        return response;
    };

    this.handleErrors = function(response) {
        var errorMessages = ERRORS[response.status];
        var errorTranslation = null;
        if(errorMessages) {
            if (response.status === 400) {
                var responseContentJson = JSON.parse(response.responseText);
                var errorTranslations = errorMessages[responseContentJson.property];
                errorTranslation = errorTranslations[errorTranslations.length - 1];
            } else {
                errorTranslation = errorMessages[errorMessages.length - 1];
            }
        } else {
            errorTranslation = response.responseText;
        }

        if (errorTranslation) {
            this.showError(errorTranslation);
        }
    };

    this.getErrorTranslation = function (errorGroup, errorkey) {
        var errorTranslationsByGroupAndKey = ERRORS[errorGroup][errorkey];
        return errorTranslationsByGroupAndKey[errorTranslationsByGroupAndKey.length - 1];
    };

    this.showErrorForLabel = function (generalLabel) {
        $("#error").html(this.getErrorTranslation("general", generalLabel));
        $("#errorDiv").show();
    };

    this.showError = function (errorMessage) {
        $("#error").html(errorMessage);
        $("#errorDiv").show();
    };

    this.hideError = function() {
        $("#error").html("");
        $("#errorDiv").hide();
    };

    this.useDebugLog = function() {
        this.debugEnabled = true;
    };

    this.debug = function(entry) {
        if (this.debugEnabled) {
            console.log(entry);
        }
    };

    this.initWithLiveAgentInformation = function(country, currency, url, agentId, ignoreCustomProducts) {
        this.country = country;
        this.currency = currency;
        this.url = url;
        this.agentId = agentId;
        this.calculatorOptions = {};
        this.disabledCustomProducts = (ignoreCustomProducts.length > 0)? ignoreCustomProducts : [];
        this.getCalculatorOptions();
        this.templates = DEFAULT_TEMPLATES;
    };

    this.initWithManualSettings = function(country, currency, manualInputParameters, calculatorOptions) {
        this.country = country;
        this.currency = currency;
        this.calculatorOptions = calculatorOptions;

        this.initShopFeeDefaultsIfNeeded(manualInputParameters);
        this.initClientCommissionDefaults(manualInputParameters);

        this.calculatorParameters = {};
        var defaultParameterSet = null;

        if (Array.isArray(manualInputParameters)) {
            defaultParameterSet = this.handleManualInputSettingsArray(manualInputParameters);
        } else {
            var calculationParameterSet = this.parseProductSettingsAndAddToCalculationSets(manualInputParameters, 0);
            this.addProductTabs(calculationParameterSet, 0, true);
            this.calculatorParameters[calculationParameterSet.customProductId] = calculationParameterSet;
            defaultParameterSet = calculationParameterSet;
        }

        this.templates = DEFAULT_TEMPLATES;
        this.setSelectedProduct(defaultParameterSet.customProductId);
        this.updateView(defaultParameterSet);
        this.calculate(defaultParameterSet);
    };

    this.handleManualInputSettingsArray = function (loanProductSettingsArray) {
        var defaultParameterSet = null;
        if (this.calculatorOptions.combineProducts) {
            defaultParameterSet = this.combineInputProducts(loanProductSettingsArray);
        } else {
            for (var index in loanProductSettingsArray) {
                var calculationParameterSet = self.parseProductSettingsAndAddToCalculationSets(loanProductSettingsArray[index], 0);
                this.addProductTabs(calculationParameterSet, index, true);
                this.calculatorParameters[calculationParameterSet.customProductId] = calculationParameterSet;
            }
            defaultParameterSet = this.calculatorParameters[loanProductSettingsArray[0].customProductId];
        }
        return defaultParameterSet;
    };

    this.combineInputProducts = function(loanProductSettingsArray) {
        var baseProductSettings = loanProductSettingsArray[0];

        var combinedCalculationParameterSet = self.parseProductSettingsAndAddToCalculationSets(baseProductSettings, 0);
        combinedCalculationParameterSet.customProductId = -1;
        combinedCalculationParameterSet.customProductName = "Combined product";

        for (var index in loanProductSettingsArray) {

            if (index == 0) {
                continue;
            }

            var currentProductSettings = loanProductSettingsArray[index];
            if (currentProductSettings.maxPeriod > baseProductSettings.maxPeriod) {

                combinedCalculationParameterSet.maxPeriod = currentProductSettings.maxPeriod;
                if (currentProductSettings.maxAmount > baseProductSettings.maxAmount) {
                    combinedCalculationParameterSet.maxAmount = currentProductSettings.maxAmount;
                }

                var currentProductPeriodSettings = this.parsePeriodSettings(currentProductSettings, 0);
                combinedCalculationParameterSet.amountLimitedPeriodParameters[index] = currentProductPeriodSettings;
            }
        }

        this.calculatorParameters[combinedCalculationParameterSet.customProductId] = combinedCalculationParameterSet;
        this.addProductTabs(combinedCalculationParameterSet, 0, false);
        return combinedCalculationParameterSet;
    };

    //Just to support manual parameters without a lot of modifications. Use shop fee as 0 for all periods
    this.initShopFeeDefaultsIfNeeded = function(inputParameters) {
        if (Array.isArray(inputParameters)) {
            for (var i = 0; i < inputParameters.length; ++i) {
                this.initShopFeeArrayWithDefaultValues(inputParameters[i]);
            }
        } else {
            this.initShopFeeArrayWithDefaultValues(inputParameters);
        }
    };

    this.initShopFeeArrayWithDefaultValues = function (inputParameters) {
        if (!inputParameters.parameters['SHOP_FEE']) {
            var shopFeeDefaults = [];
            for(var i = inputParameters.minPeriod; i <= inputParameters.maxPeriod; ++i) {
                shopFeeDefaults.push(0)
            }
            inputParameters.parameters['SHOP_FEE'] = shopFeeDefaults;
        }
    };

    //Just to support manual parameters without a lot of modifications. Use client_commission as false for all periods
    this.initClientCommissionDefaults = function(inputParameters) {
        if (Array.isArray(inputParameters)) {
            for (var i = 0; i < inputParameters.length; ++i) {
                this.initClientCommissionArrayWithDefaultValues(inputParameters[i]);
            }
        } else {
            this.initClientCommissionArrayWithDefaultValues(inputParameters);
        }
    };

    this.initClientCommissionArrayWithDefaultValues = function (inputParameters) {
        if (!inputParameters.clientCommission) {
            var clientCommissionDefaults = [];
            for (var i = inputParameters.minPeriod; i <= inputParameters.maxPeriod; ++i) {
                clientCommissionDefaults.push(false)
            }
            inputParameters.clientCommission = new Object();
            inputParameters.clientCommission['COMMISSION_FOR_CLIENT'] = clientCommissionDefaults;
        }
    };

    this.changeTemplate = function (id, newTemplate) {
        this.templates[id] = newTemplate;
    };

    this.processTemplate = function (id, periodResults) {
        var processedTemplate = this.templates[id];
        processedTemplate = processedTemplate.replace('[monthly-payment]', periodResults.monthlyPayment);
        processedTemplate = processedTemplate.replace('[apr]', periodResults.apr);
        processedTemplate = processedTemplate.replace('[commission-fee]', periodResults.commissionFee);
        processedTemplate = processedTemplate.replace('[admin-fee]', periodResults.adminFee);
        processedTemplate = processedTemplate.replace('[interest-cost]', periodResults.interestCost);
        processedTemplate = processedTemplate.replace('[total-cost]', periodResults.totalCost);
        processedTemplate = processedTemplate.replace('[currency]', this.currency);
        return processedTemplate;
    };

    this.setSelectedProduct = function(selectedProductId) {
        this.selectedProduct = selectedProductId;
    };

    this.addTranslations = function(translations) {
        Object.keys(translations).forEach(function(translationKey) {
            Object.keys(ERRORS).forEach(function(errorKey) {
                self.addTranslation(errorKey, translationKey, translations);
            });
        });
    };

    this.addTranslation = function(errorKey, translationKey, translations) {
        var errorGroup = ERRORS[errorKey];
        if (errorKey == 400 || errorKey == "general") {
            Object.keys(errorGroup).forEach(function(badRequestErrorGroup) {
                if(badRequestErrorGroup === translationKey) {
                    ERRORS[errorKey][badRequestErrorGroup].push(translations[translationKey]);
                }
            });
        } else {
            if (errorGroup[0] === translationKey) {
                ERRORS[errorKey].push(translations[translationKey]);
            }
        }
    };

    this.addCommas = function(nStr) {
        nStr += '';
        var x = nStr.split('.');
        var x1 = x[0];
        var x2 = x.length > 1 ? '.' + x[1] : '';
        var rgx = /(\d+)(\d{3})/;
        while (rgx.test(x1)) {
            x1 = x1.replace(rgx, '$1' + ' ' + '$2');
        }
        return x1 + x2;
    };

    this.getCalculatorOptions = function() {
        var self = this;
        $.ajax({
            type: "GET",
            contentType: "application/json",
            url: this.url + "/rest/public/e-shop/parameters/multi/1.0/country/" + this.country + "/agent/" + this.agentId,
            success: function (data) {
                if (!data) {
                    return;
                }

                self.debug("Fetched data:");
                self.debug(data);

                self.calculatorParameters = new Object();
                self.calculatorOptions = (typeof data.calculatorOptions != 'undefined')? data.calculatorOptions : {};
                for (var index in data.loanProductParametersResponseList) {

                    var customProductId = data.loanProductParametersResponseList[index].customProductId;
                    if (self.disabledCustomProducts.indexOf(customProductId) != -1) {
                        //don't add disabled custom products
                        continue;
                    }

                    var calculationParameterSet = self.parseProductSettingsAndAddToCalculationSets(data.loanProductParametersResponseList[index], 0);
                    self.addProductTabs(calculationParameterSet, index, true);
                    self.calculatorParameters[calculationParameterSet.customProductId] = calculationParameterSet;
                }

                var firstProductId = data.loanProductParametersResponseList[0].customProductId;
                var initialSelection = self.calculatorParameters[firstProductId];

                self.setSelectedProduct(firstProductId);
                self.updateView(initialSelection);
                self.calculate(initialSelection);
            },
            error: function (response) {
                self.handleErrors(response);
            }
        })
    };

    this.parseProductSettingsAndAddToCalculationSets = function(productSettings, amountLimitedSetIndex) {
        var calculationLoanProductSettingSet = {
            customProductId : productSettings.customProductId,
            customProductName : productSettings.customProductName,
            calculateInterestOnlyOnPrincipal : typeof(productSettings.calculateInterestOnlyOnPrincipal) != "undefined"? productSettings.calculateInterestOnlyOnPrincipal : false,
            customerDisclaimer : productSettings.customerDisclaimer,
            minAmount : productSettings.minAmount,
            maxAmount : productSettings.maxAmount,
            minPeriod : productSettings.minPeriod,
            maxPeriod : productSettings.maxPeriod,
            amountLimitedPeriodParameters : {}
        };

        calculationLoanProductSettingSet.amountLimitedPeriodParameters[amountLimitedSetIndex] = this.parsePeriodSettings(productSettings, 0);
        return calculationLoanProductSettingSet;
    };

    this.parsePeriodSettings = function (productSettings, startIndex) {
        var periodIndex = startIndex;
        var amountLimitedPeriodSettings = {
            minAmount : productSettings.minAmount,
            maxAmount : productSettings.maxAmount,
            minPeriod : productSettings.minPeriod,
            maxPeriod : productSettings.maxPeriod,
            periodParameters : {}
        };

        for (var i = productSettings.minPeriod; i <= productSettings.maxPeriod; i++) {
            var currentPeriodSettings = {
                period: i,
                forReturningCustomerOnly : typeof(productSettings.forReturningCustomerOnly) != "undefined"? productSettings.forReturningCustomerOnly : false,
                customerDisclaimer : productSettings.customerDisclaimer,
                calculateOnlyForPrincipal: productSettings.calculateInterestOnlyOnPrincipal,
                interest: productSettings.parameters['INTEREST'][periodIndex],
                comm_fee: productSettings.parameters['COMMISSION'][periodIndex],
                shop_fee: productSettings.parameters['SHOP_FEE'][periodIndex],
                admin_fee: productSettings.parameters['ADMIN_FEE'][periodIndex],
                client_commission: productSettings.clientCommission['COMMISSION_FOR_CLIENT'][periodIndex],
            };

            amountLimitedPeriodSettings.periodParameters[i] = currentPeriodSettings;
            periodIndex++;
        }
        return amountLimitedPeriodSettings;
    };

    this.fetchCombinedPeriodsForCalculatorParameters = function (calculationParameterSet) {
        var availablePeriods = [];
        for (var calculationParameterIndex in calculationParameterSet.amountLimitedPeriodParameters){
            var periodParameterSet = calculationParameterSet.amountLimitedPeriodParameters[calculationParameterIndex];
            for (var parameterSetIndex in periodParameterSet.periodParameters) {
                var periodParameters = periodParameterSet.periodParameters[parameterSetIndex];
                if (availablePeriods.indexOf(periodParameters.period) == -1) {
                    availablePeriods.push(periodParameters.period);
                }
            }
        }
        return availablePeriods;
    };

    this.findAmountLimitedPeriodParameterSets = function (periodParameters) {
        var validAmountLimitedPeriodParameterSets = [];
        var selectedAmount = this.getCurrentAmountSelectionValue();
        var selectedPeriod = this.getCurrentPeriodSelectionValue();
        for (var index in periodParameters) {
            var periodParameterSet = periodParameters[index];
            if (selectedAmount >= periodParameterSet.minAmount
                && selectedAmount <= periodParameterSet.maxAmount
                && selectedPeriod >= periodParameterSet.minPeriod
                && selectedPeriod <= periodParameterSet.maxPeriod
            ) {
                this.debug("Found period parameter set for amount: " + selectedAmount);
                validAmountLimitedPeriodParameterSets.push(periodParameterSet);
            }
        }
        return validAmountLimitedPeriodParameterSets;
    };

    this.findPeriodParameterSet = function(selectedPeriodParametersSets, period) {
        for (var index in selectedPeriodParametersSets) {
            if(typeof(selectedPeriodParametersSets[index].periodParameters[period]) != 'undefined') {
                return selectedPeriodParametersSets[index].periodParameters[period];
            }
        }
        return null;
    };

    this.getCombinedParameterSets = function(selectedPeriodParametersSets) {
        var combinedParameterSet = {};
        for (var parameterSetIndex in selectedPeriodParametersSets) {
            for (var periodParameterSetIndex in selectedPeriodParametersSets[parameterSetIndex].periodParameters) {
                var currentPeriodParameterSet = selectedPeriodParametersSets[parameterSetIndex].periodParameters[periodParameterSetIndex];
                if (!combinedParameterSet[periodParameterSetIndex]) {
                    combinedParameterSet[periodParameterSetIndex] = currentPeriodParameterSet;
                }
            }
        }
        return combinedParameterSet;
    };

    this.getVisibleTabPeriods = function (allAvailablePeriods) {
        var visiblePeriods = [];
        for (var periodIndex in allAvailablePeriods) {
            var numberOfPeriods = allAvailablePeriods.length;
            var periodStep = Math.ceil(numberOfPeriods / 10);
            var remainder = periodIndex % periodStep;
            if (numberOfPeriods > 10 && remainder > 0) {
                continue;
            }
            visiblePeriods.push(allAvailablePeriods[periodIndex]);
        }
        return visiblePeriods;
    };

    this.calculateLoanConditions = function(options) {
        this.debug("Calculating conditions...");

        var extraCost = this.calcExtras(options);

        this.debug("Total extra cost: " + extraCost);

        options.extraFee += extraCost;

        var monthlyPayment = this.calculateMonthlyPayment(options);
        this.debug("Monthly payment: " + monthlyPayment);

        var totalCost = this.calculateTotalCost(monthlyPayment, options);

        var apr = this.calcApr(options, Math.round(monthlyPayment.total*100)/100);
        var aprIRR = this.calcAprIRR(options, totalCost, Math.round(monthlyPayment.total*100)/100);
        var xirr = this.calculateXIRR(options, totalCost, monthlyPayment.total);

        var calculationResult = {
            loanAmount : options.amount.toFixed(2),
            loanPeriod : options.numPayments,
            monthlyPayment : monthlyPayment.total.toFixed(2),
            commissionFee : options.clientCommissionAmount.toFixed(2),
            adminFee : options.adminFeeAmount.toFixed(2),
            interestCost : Math.abs(totalCost - options.amount - options.adminFeeAmount - options.clientCommissionAmount).toFixed(2),
            totalCost : totalCost.toFixed(2),
            apr : aprIRR,
            xirr : xirr.toFixed(2),
            forReturningCustomerOnly : options.forReturningCustomerOnly,
            customerDisclaimer : options.customerDisclaimer
        };

        this.debug("Finished calculating conditions");

        return calculationResult;
    };

    //Calculated with reminder because LES uses last installment to correct roundings. This way
    //calculation can be the same as LES is doing it.
    this.calculateDailyInterestWithReminder = function(monthylPayment, options) {
        var reminderLoanAmount = options.amount;
        var today = new Date();
        today.setHours(0, 0, 0, 0);

        var firstPaymentDate = this.setFirstRepaymentDate(today);
        var totalInterestCost = 0.0;
        for (var i = 1; i <= options.numPayments; i++) {

            var nextPaymentDate = this.addMonths(firstPaymentDate, i - 1);

            var previousPaymentDate = this.subtractOneMonth(nextPaymentDate);
            if (previousPaymentDate < today) {
                previousPaymentDate = today;
            }

            var diffDays = Math.round(Math.abs((previousPaymentDate - nextPaymentDate) / ONE_DAY_IN_MILLISECONDS));
            this.debug("Days diff: " + diffDays);

            var interestCostForPeriod = Math.round(reminderLoanAmount*options.interestRate/100/365*diffDays*100)/100;
            this.debug("Interest cost for period: " + interestCostForPeriod);

            reminderLoanAmount -= Math.round(monthylPayment.principal*100)/100 - interestCostForPeriod;
            this.debug("Reminder loan amount: " + reminderLoanAmount);

            totalInterestCost += interestCostForPeriod;
        }

        return {
            totalInterest: totalInterestCost,
            reminder: Math.round(reminderLoanAmount*100)/100
        };
    };

    this.calculateTotalCost = function(monthlyPayment, options) {
        if (options.interestRate === 0) {
            return options.amount + options.extraFee + options.adminFeeAmount;
        } else {
            var roundedTotal = (Math.round(monthlyPayment.total * 100) / 100) * options.numPayments;
            roundedTotal += monthlyPayment.commissionRoundingDifference;

            if (this.calculatorOptions.dailyInterestOnPrincipalOnly) {
                var interestWithReminder = this.calculateDailyInterestWithReminder(monthlyPayment, options);
                return roundedTotal + interestWithReminder.reminder;
            } else {
                return roundedTotal;
            }
        }
    };

    this.calculateForSelected = function() {
        if(this.selectedProduct == null) {
            console.log("No calculation parameters.");
            return;
        } else {
            return this.calculate(this.calculatorParameters[this.selectedProduct]);
        }
    };

    this.calculateForProduct = function(customProductId) {
        var productSettings = this.calculatorParameters[customProductId];
        this.updateView(productSettings);
        this.calculate(productSettings);
    };

    this.calculate = function(calculationParameters) {
        this.debug("Calculating...");
        $('.period-monthly-payment').text('');

        var selectedPeriodParametersSets = this.findAmountLimitedPeriodParameterSets(calculationParameters.amountLimitedPeriodParameters);
        var selectedPeriodParameters = this.findPeriodParameterSet(selectedPeriodParametersSets, this.getCurrentPeriodSelectionValue());

        if (!selectedPeriodParameters) {
            this.showErrorForLabel("invalid.period.or.loan.amount");
            return;
        } else {
            this.hideError();
        }

        var result = this.calculateForPeriod(selectedPeriodParameters);
        this.debug("Calculated results for period: " + this.getCurrentPeriodSelectionValue());

        this.debug("Calculating results for all other periods...");
        this.calculateLoanConditionsForAllPeriods(calculationParameters);

        this.debug("Finished calculations");

        this.updateResultsView(result);

        this.debug("Finished updating view");
    };

    this.calculateLoanConditionsForAllPeriods = function(calculationParameters) {
        var combinedParameterSets = this.getCombinedParameterSets(calculationParameters.amountLimitedPeriodParameters);
        var allPeriods = this.fetchCombinedPeriodsForCalculatorParameters(calculationParameters);
        var visibleTabPeriods = this.getVisibleTabPeriods(allPeriods);
        for (var periodIndex in visibleTabPeriods) {
            var periodParameters = combinedParameterSets[visibleTabPeriods[periodIndex]];
            var periodResult = this.calculateForPeriod(periodParameters);
            $('#period-monthly-payment-' + calculationParameters.customProductId + '-' + periodParameters.period)
                .text(this.processTemplate('PERIOD_INFORMATION_TEMPLATE', periodResult));
        }
    };

    this.calculateForPeriod = function(periodParameters) {
        var loanAmount = this.getCurrentAmountSelectionValue();

        var commissionFeePercentage = periodParameters.comm_fee;
        var shopFeePercentage = periodParameters.shop_fee;
        var adminFeePercentage = periodParameters.admin_fee;
        var annualInterestPercentage = periodParameters.interest;
        var commissionPaidByClient = periodParameters.client_commission;

        var commissionFeeRate = commissionFeePercentage / 100;
        var adminFeeRate = adminFeePercentage / 100;
        var shopFeeRate = shopFeePercentage / 100;

        var shopFeeAmount = loanAmount*shopFeeRate;

        var clientCommission = (commissionPaidByClient)? loanAmount*commissionFeeRate : (loanAmount*commissionFeeRate) - shopFeeAmount;
        var options = {
            amount: loanAmount,
            numPayments: periodParameters.period,
            interestRate: parseFloat(annualInterestPercentage),
            commissionRate: commissionFeeRate,
            commissionAmount: loanAmount*commissionFeeRate,
            clientCommissionAmount: clientCommission,
            commissionPaidByClient: commissionPaidByClient,
            adminRate: adminFeeRate,
            adminFeeAmount: loanAmount*adminFeeRate*periodParameters.period,
            shopFeeAmount: shopFeeAmount,
            extraFee: 0,
            compoundFrequency: (typeof this.calculatorOptions.compoundFrequency) != 'undefined'? this.calculatorOptions.compoundFrequency :  12,
            paymentFrequency: 12,
            calculateOnlyForPrincipal : periodParameters.calculateOnlyForPrincipal,
            forReturningCustomerOnly : periodParameters.forReturningCustomerOnly,
            customerDisclaimer : periodParameters.customerDisclaimer
        };

        this.debug("Calculating for values:");
        this.debug(options);

        return this.calculateLoanConditions(options);
    };

    this.calculateMonthlyPayment = function(options) {

        var monthlyRepayment = {
            principal: 0.0,
            admin: 0.0,
            commission: 0.0,
            commissionRoundingDifference: 0.0,
            interest: 0.0,
            total: 0.0
        };

        this.debug("Calculating monthly payment...");

        var r = Math.pow(1 +options.interestRate /100 /options.compoundFrequency, options.compoundFrequency /options.paymentFrequency) -1;

        this.debug("r=" + r);

        var result = 0;
        var principalMonthlyRepayment = 0.0;
        if(r > 0) {

            if (this.calculatorOptions.dailyInterestOnPrincipalOnly) {
                this.debug("Calculating Daily Interest On Principal")
                var interestReal = options.interestRate/100/12;
                principalMonthlyRepayment = (options.amount*interestReal)/(1 - Math.pow((1+interestReal), 0 - options.numPayments));
            } else {
                this.debug("Calculating regular(old) interest")

                principalMonthlyRepayment = ((options.amount) * r * Math.pow((1 + r), options.numPayments)) / (Math.pow((1 + r), options.numPayments) - 1);
                principalMonthlyRepayment = Math.round(principalMonthlyRepayment*100)/100;
                this.debug("Monthly payment Principal: " + principalMonthlyRepayment);

                var extraCostMonthlyRepayment = ((options.extraFee) * r * Math.pow((1 + r), options.numPayments)) / (Math.pow((1 + r), options.numPayments) - 1);
                extraCostMonthlyRepayment = Math.round(extraCostMonthlyRepayment*100)/100;
                this.debug("Monthly payment Extra: " + extraCostMonthlyRepayment);

                principalMonthlyRepayment += extraCostMonthlyRepayment;

                this.debug("Monthly payment total: " + principalMonthlyRepayment);
            }
            this.debug("Result for r > 0: " + result);
        } else {
            principalMonthlyRepayment = (options.amount + options.extraFee) /options.numPayments;
            this.debug("Result for r <= 0: " + result);

        }
        result += principalMonthlyRepayment;

        var adminFeeMonthlyPayment = options.adminFeeAmount/options.numPayments;
        adminFeeMonthlyPayment = Math.round(adminFeeMonthlyPayment * 100) / 100;
        this.debug("Admin fee monthly: " + adminFeeMonthlyPayment);

        var commissionRoundingDifference = 0.0;
        if (options.calculateOnlyForPrincipal) {
            var clientCommissionMonthly = options.clientCommissionAmount / options.numPayments;
            clientCommissionMonthly = Math.round(clientCommissionMonthly * 100) / 100;
            this.debug("Client commission monthly: " + clientCommissionMonthly);

            result += clientCommissionMonthly;

            commissionRoundingDifference = options.clientCommissionAmount - (clientCommissionMonthly * options.numPayments);
            commissionRoundingDifference = Math.round(commissionRoundingDifference * 100) / 100;
        }

        result += adminFeeMonthlyPayment;

        //Keep more decimals for APR calculation. Then no difference with LES
        var resultMonthlyPayment = Math.round(result * 1000000 ) / 1000000;
        this.debug("Calculated total monthly payment: " + resultMonthlyPayment);

        this.debug("Finished calculating monthly payment");

        monthlyRepayment.principal = principalMonthlyRepayment;
        monthlyRepayment.admin = adminFeeMonthlyPayment;
        monthlyRepayment.commission = clientCommissionMonthly;
        monthlyRepayment.commissionRoundingDifference = commissionRoundingDifference;
        monthlyRepayment.total = result;

        return monthlyRepayment;
    };

    this.calcApr = function(options, monthlyPayment) {
        this.debug("Calculating APR...");
        this.debug(options);
        this.debug("Monthly payment for APR: " + monthlyPayment);

        //Keep more decimals for APR calculation. Then no difference with LES
        var roundedMonthlyPayment = Math.round(monthlyPayment*1000000)/1000000;
        this.debug("Rounded monthly payment for APR: " + roundedMonthlyPayment);

        var diff =  roundedMonthlyPayment/options.amount;
        this.debug("Initial diff: " + diff);

        if (options.extraFee == 0 && options.adminFeeAmount == 0 && options.interestRate == 0) {
            this.debug("No extra fees nor interest. Not calculating APR.");
            return 0;
        }

        var a = 0.05;
        var z = 0;
        var iteration = 1;
        do {
            this.debug("Iteration start: " + iteration);
            var fx = a * Math.pow((1 + a), options.numPayments);
            this.debug("fx = " + fx);

            var dx = Math.pow((1 + a), options.numPayments) - 1;
            this.debug("dx = " + dx);

            z = (fx / dx) - diff;
            this.debug("z = " + z);

            a = a - z;
            this.debug("a = " + a);

            this.debug("Iteration end: " + iteration);
            iteration++;
        } while(Math.abs(z) > 1e-9);

        var apr = 100*options.compoundFrequency*(Math.pow(a+1, options.paymentFrequency/options.compoundFrequency) - 1);
        this.debug("APR percentile: " + apr);

        var aprReult = Math.round(apr *100) /100;
        this.debug("Calculated APR: " + aprReult);

        this.debug("Finished APR calculations");

        return aprReult;
    };

    this.calcAprIRR = function(options, totalCost, monthlyPayment) {
        var transactions = this.prepareTransactions(options, totalCost, monthlyPayment);
        var transactionCashFlows = [];
        for (var transaction in transactions) {
            var foundCashFlow = transactions[transaction].cashFlow;
            transactionCashFlows.push(foundCashFlow);
        }

        var irr = Math.round(this.calculateIRR(10000, transactionCashFlows) * 10000) / 10000;
        return Math.round(irr * 12 * 100) / 100;
    };

    this.calculateIRR = function(maxIterations, transactions) {
        var x = 1;
        var iterationCount = 1;
        while (this.calculateNPV(x, iterationCount, maxIterations, transactions) > 0) {
            x += 1;
            iterationCount += 1;
        }
        while (this.calculateNPV(x, iterationCount, maxIterations, transactions) < 0) {
            x -= 0.0001;
            iterationCount += 1;
        }
        return x + 0.0001;
    };

    this.calculateNPV = function(rate, iterationCount, maxIterations, transactions) {
        if (iterationCount > maxIterations) {
            throw new Error('Can\'t find IRR within maxIterations');
        }
        var rrate = (1 + rate / 100);
        var npv = transactions[0];
        for (var i = 1; i < transactions.length; i++) {
            npv += (transactions[i] / Math.pow(rrate, i));
        }
        return npv;
    };

    this.calcExtras = function(options) {
        var result = 0;
        if (!options.calculateOnlyForPrincipal) {
            result += options.clientCommissionAmount;
        }
        return Math.round(result *100) /100;
    };

    this.calculateNetPresentValue =  function(rate, transactions) {
        var netPresentValue = 0.0;
        var firstDate = transactions[0].date;
        for (var key in transactions) {
            var transaction = transactions[key];
            netPresentValue += transaction.cashFlow / Math.pow(1 + rate, this.daysBetween(firstDate, transaction.date)/365);
        }
        return netPresentValue;
    };

    this.prepareTransactions = function(options, totalCost, monthlyPayment) {
        this.debug("Preparing transactions for XIRR");

        var principalAmount = options.amount;
        this.debug("Principal amount: " + principalAmount);

        var transactions = new Object();
        var today = new Date();
        today.setHours(0, 0, 0, 0);

        var firstPaymentDate = this.setFirstRepaymentDate(today);

        transactions[0] = {cashFlow: -Math.abs(principalAmount), date: today};
        this.debug("Added initial transaction: ");
        this.debug(transactions[0]);

        var payBackReminder = totalCost;
        this.debug("Initial payback reminder: " + payBackReminder);

        for (var i = 1; i <= options.numPayments; i++) {
            this.debug("Preparing transaction: " + i);

            var paymentDate = this.addMonths(firstPaymentDate, i - 1);

            var paybackAmount = (i == options.numPayments)? payBackReminder.toFixed(2) : monthlyPayment;
            transactions[i] = {cashFlow: Math.abs(paybackAmount), date: paymentDate};
            this.debug(transactions[i]);

            payBackReminder = Math.round((payBackReminder - paybackAmount)*100)/100;
            this.debug("PaybackReminder: " + payBackReminder);
        }

        return transactions;
    };

    this.calculateXIRR = function(options, totalCost, monthlyPayment) {

        this.debug("Initial monthly payment fro XIRR: " + monthlyPayment);

        //Floor monthly payment to 2 decimals so it matches LES
        var flooredMonthlyPayment = Math.floor(monthlyPayment*100)/100;
        this.debug("Floored monthly payment for XIRR: " + flooredMonthlyPayment);

        var cashFlow = this.prepareTransactions(options, totalCost, flooredMonthlyPayment);

        var x1 = 0.0;
        var x2 = 0.01;
        var f1 = this.calculateNetPresentValue(x1, cashFlow);
        var f2 = this.calculateNetPresentValue(x2, cashFlow);

        do {
            if (Math.abs(f1) < Math.abs(f2)) {
                f1 = this.calculateNetPresentValue(x1 += 1.6 * (x1 - x2), cashFlow);
            } else {
                f2 = this.calculateNetPresentValue(x2 += 1.6 * (x2 - x1), cashFlow);
            }
        } while((f1 * f2) >= 0.0);

        var f = this.calculateNetPresentValue(x1, cashFlow);
        var rtb = (f < 0.0)? x1 : x2;
        var dx = (f < 0.0)? (x2 - x1) : (x1 - x2);

        do {
            dx *= 0.5;
            var x_mid = rtb + dx;
            var f_mid = this.calculateNetPresentValue(x_mid, cashFlow);
            if (f_mid <= 0.0) {
                rtb = x_mid;
            }
        } while((Math.abs(f_mid) >= 1.0e-6) && (Math.abs(dx) >= 1.0e-6));

        return Math.round(x_mid*10000)/100;
    };

    this.setFirstRepaymentDate = function(today) {
        var firstRepaymentDate = new Date(today);

        if (this.calculatorOptions.useMinDaysForFirstRepayment) {
            firstRepaymentDate.setDate(today.getDate() + this.calculatorOptions.minDays);
        } else {
            firstRepaymentDate = this.addMonths(today, 1);
        }

        return firstRepaymentDate;
    };

    this.addMonths = function(initialDate, numberOfMonths) {
        var monthBasedOnSum = initialDate.getMonth() + numberOfMonths;

        // Months are between 0 - 11 in Javascript (adjust month number if needed)
        while (monthBasedOnSum > 11) {
            monthBasedOnSum -= 12;
        }

        var calculatedDate = new Date(initialDate);
        calculatedDate.setMonth(calculatedDate.getMonth() + numberOfMonths);
        var monthOfCalculatedDate = calculatedDate.getMonth();

        if (monthOfCalculatedDate === monthBasedOnSum) {
            return calculatedDate;

        // Otherwise use the last day of the month, like in LES
        } else {
            var firstDayOfInitialDate = new Date(initialDate.getFullYear(), initialDate.getMonth(), 1);
            calculatedDate = firstDayOfInitialDate;
            calculatedDate.setMonth(calculatedDate.getMonth() + numberOfMonths);
            var lastDayOfCalculatedDate = new Date(calculatedDate.getFullYear(), calculatedDate.getMonth() + 1, 0);

            return lastDayOfCalculatedDate;
        }
    };

    this.subtractOneMonth = function(initialDate) {
        var calculatedDate = new Date(initialDate);
        calculatedDate.setMonth(calculatedDate.getMonth() - 1);

        var lastDateOfPreviousMonth = new Date(initialDate.getFullYear(), initialDate.getMonth(), 0);

        if (lastDateOfPreviousMonth < calculatedDate) {
            return lastDateOfPreviousMonth;
        }

        return calculatedDate;
    };

    this.getCurrentPeriodSelectionValue = function() {
        return parseInt($('#months').val());
    };

    this.getCurrentAmountSelectionValue = function() {
        return parseFloat($('#amount').val());
    };

    this.updateResultsView = function(result) {
        $("#loanAmount").html(this.addCommas(result.loanAmount) + ' ' + this.currency);
        $("#loanPeriod").html(result.loanPeriod);
        $("#newCustomer").prop('checked', !result.forReturningCustomerOnly);
        $("#returningCustomer").prop('checked', result.forReturningCustomerOnly);
        $("#customerDisclaimer").html(result.customerDisclaimer);
        $("#monthlyPayment").html(this.addCommas(result.monthlyPayment)+ ' ' + this.currency);
        $("#commissionFee").html(this.addCommas(result.commissionFee)+ ' ' + this.currency);
        $("#adminFee").html(this.addCommas(result.adminFee)+ ' ' + this.currency);
        $("#interestCost").html(this.addCommas(result.interestCost)+ ' ' + this.currency);
        $("#totalCost").html(this.addCommas(result.totalCost)+ ' ' + this.currency);
        $("#apr").html(result.apr);
        $("#xirr").html(result.xirr);
    };

    this.updateView = function(parameterSet) {
        $("#rangeInput").attr({
            "min" : parameterSet.minAmount,
            "max" : parameterSet.maxAmount
        });

        $("#amount").attr({
            "min" : parameterSet.minAmount,
            "max" : parameterSet.maxAmount
        });
        var amount = $("#amount").val();
        if (typeof amount == 'undefined' || amount == 0) {
            $("#amount").val(parameterSet.minAmount);
            $("#rangeInput").val(parameterSet.minAmount);
        } else {
            $("#amount").val(amount);
            $("#rangeInput").val(amount);
        }

        $("#periodInput").attr({
            "min" : parameterSet.minPeriod,
            "max" : parameterSet.maxPeriod
        });

        $("#months").attr({
            "min" : parameterSet.minPeriod,
            "max" : parameterSet.maxPeriod
        });
        var period = $("#months").val();
        if (typeof period == 'undefined' || period == 0 || period < parameterSet.minPeriod) {
            $("#months").val(parameterSet.minPeriod);
            $("#periodInput").val(parameterSet.minPeriod);
        } else {
            $("#months").val(period);
            $("#periodInput").val(period);
        }

    };

    $('#amount').change(function(){
        $('#rangeInput').val($('#amount').val());
        self.calculateForSelected();
    });

    $('#rangeInput').on('input', function(){
        $('#amount').val($('#rangeInput').val());
        self.calculateForSelected();
    });

    $('#months').change(function(){
        $('#periodInput').val($('#months').val());
        self.calculateForSelected();
    });

    $('#periodInput').on('input', function(){
        $('#months').val($('#periodInput').val());
        self.calculateForSelected();
    });

    $('#nav-tab').on('click', '.nav-item', function(e) {
        $('.nav-item').each(function() {
            $(this).removeClass('active');
            $(this).attr('aria-selected', 'false');
        });
        $('.tab-pane').each(function() {
            $(this).removeClass('active');
            $(this).removeClass('show');
        });

        $(this).addClass('active');
        $(this).attr('aria-selected', 'true');
        var selectedProductId = Number(e.target.id.split('-')[2]);

        $('#product-'+ selectedProductId).addClass('active');
        $('#product-'+ selectedProductId).addClass('show');

        self.setSelectedProduct(selectedProductId);
        self.calculateForProduct(selectedProductId);
    });

    $('#nav-tabContent').on('click', '.list-group-item', function() {
        var periodTabId = $(this).get(0).id;
        $('#months').val(periodTabId);
        $('#periodInput').val(periodTabId);
        self.calculateForSelected();
    });

    $(':radio').click(function(){
        return false;
    });

    this.addProductTabs = function(calculationParameterSet, index, showNameTab) {
        var selected = (index == 0)? 'true' : 'false';
        var active = (index == 0)? 'active' : '';
        if (showNameTab) {
            $('#nav-tab').append($('<a class="nav-item nav-link ' + active + '" id="product-tab-' + calculationParameterSet.customProductId + '"' +
                'data-toggle="tab" href="#product-' + calculationParameterSet.customProductId + '" role="tab" aria-selected="'+selected+'">' + calculationParameterSet.customProductName + '</a>'));
        }
        $('#nav-tabContent').append($('<div class="tab-pane fade show ' + active + '" id="product-' + calculationParameterSet.customProductId + '" ' +
            'role="tabpanel" aria-labelledby="product-tab-' + calculationParameterSet.customProductId + '">' + self.addTabContent(calculationParameterSet) + '</div>'));
    };

    this.addTabContent = function(calculationParameterSet) {
        var allAvailablePeriods = this.fetchCombinedPeriodsForCalculatorParameters(calculationParameterSet);
        var content = '<div id="product-period-content" class="list-group list-group-horizontal">';
        var visiblePeriods = this.getVisibleTabPeriods(allAvailablePeriods);
        for (var periodIndex in visiblePeriods) {
            content += '<div id="' + visiblePeriods[periodIndex] + '" class="list-group-item list-group-item-action">';
            content += '<div class="row justify-content-center"><h3>' + visiblePeriods[periodIndex] + '</h3></div>';
            content += '<div id="period-monthly-payment-' + calculationParameterSet.customProductId + '-' + visiblePeriods[periodIndex] + '" ' +
                'class="row justify-content-center period-monthly-payment" style="font-size: 12px;"></div>';
            content += '</div>';
        }

        content += '</div>';
        content += 'Select period in months';
        return content;
    };
};