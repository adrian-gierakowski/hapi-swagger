'use strict';
var Hoek                    = require('hoek'),
    Joi                     = require('joi');

var Definitions             = require('../lib/definitions'),
    Properties              = require('../lib/properties'),
    Responses               = require('../lib/responses');

var internals = {},
    paths = module.exports = {};


// default data for path
paths.defaults = {
    responses: {}
};


// schema for paths
paths.schema = Joi.object({
    tags: Joi.array().items(Joi.string()),
    summary: Joi.string(),
    description: Joi.string(),
    externalDocs: Joi.object({
        description: Joi.string(),
        url: Joi.string().uri()
    }),
    operationId: Joi.string(),
    consumes: Joi.array().items(Joi.string()),
    produces: Joi.array().items(Joi.string()),
    parameters: Joi.array().items(Joi.object()),
    responses: Joi.object().required(),
    schemes: Joi.array().items(Joi.string().valid(['http', 'https', 'ws', 'wss'])),
    deprecated: Joi.boolean(),
    security: Joi.array().items(Joi.object())
});





/**
 * build the swagger path section
 *
 * @param  {Object} setting
 * @param  {Object} routes
 * @return {Object}
 */
paths.build = function ( settings, routes ){

    var routesData = [];

    // loop each route
    routes.forEach(function (route) {

        // only include routes tagged with 'api'
        if (!route.settings.tags || route.settings.tags.indexOf('api') < 0){
            return;
        }

        var routeOptions = Hoek.reach(route,'settings.plugins.hapi-swagger') || {};
        var routeData = {
            path: route.path,
            method: route.method.toUpperCase(),
            description: route.settings.description,
            notes: route.settings.notes,
            tags: Hoek.reach(route,'settings.tags'),
            queryParams: Hoek.reach(route,'settings.validate.query'),
            pathParams: Hoek.reach(route,'settings.validate.params'),
            payloadParams: Hoek.reach(route,'settings.validate.payload'),
            responseSchema: Hoek.reach(route,'settings.response.schema'),
            responseStatus: Hoek.reach(route,'settings.response.status'),
            headerParams: Hoek.reach(route,'settings.validate.headers'),
            responses: Hoek.reach(routeOptions,'responses') || {},
            nickname: Hoek.reach(routeOptions,'nickname') || null,
            payloadType: Hoek.reach(routeOptions,'payloadType') || null,
            security: Hoek.reach(routeOptions,'security') || null,
            groups: route.group
        };


        // user configured interface through route plugin options
        if (Hoek.reach(routeOptions, 'validate.query')){
            routeData.queryParams =  Properties.objectToArray( Hoek.reach(routeOptions, 'validate.query') );
        }
        if (Hoek.reach(routeOptions,'validate.params')){
            routeData.pathParams =  Properties.objectToArray( Hoek.reach(routeOptions,'validate.params') );
        }
        if (Hoek.reach(routeOptions, 'validate.headers')){
            routeData.headerParams =  Properties.objectToArray( Hoek.reach(routeOptions, 'validate.headers') );
        }
        if (Hoek.reach(routeOptions, 'validate.payload')){
            // has different structure, just pass straight through
            routeData.payloadParams =  Hoek.reach(routeOptions, 'validate.payload' );
             // if its a native javascript object convert it to JOI
            if (!routeData.payloadParams.isJoi){
                routeData.payloadParams = Joi.object(routeData.payloadParams);
            }
        }


        // TODO needs rewritting to use new securityDefinitions
        /*
        if (route.settings.auth && settings.authorizations) {
            route.settings.auth.strategies.forEach(function(strategie) {
                if (settings.authorizations[strategie] && settings.authorizations[strategie].type){
                   routeData.authorizations[settings.authorizations[strategie].type] = settings.authorizations[strategie]
                }
            });
        }
        */

        // hapi wildcard method support
        if (routeData.method === '*'){
            // OPTIONS not supported by Swagger and HEAD not support by HAPI
            ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].forEach(function (method) {

                var newRoute = Hoek.clone( routeData );
                newRoute.method = method.toUpperCase();
                routesData.push(newRoute);
            });
        } else {
            routesData.push(routeData);
        }
    });

    return paths.properties( settings, routesData);
};


/**
 * build the swagger path section
 *
 * @param  {Object} setting
 * @param  {Object} routes
 * @return {Object}
 */
paths.properties = function ( settings, routes ){

    var pathObj = {},
        swagger = {
            'definitions': {
            }
        };

    routes.forEach(function (route, indexA) {

        //console.log(route.path,route.method)

        var method = route.method,
            out = {
                'summary': route.description,
                'operationId': route.nickname || route.path.replace(/\//gi, '').replace(/\{/gi, '').replace(/\}/gi, ''),
                'description': route.notes,
                'parameters': []
            },
            path = route.path;

        // tags in swagger are used for grouping
        if (route.groups){
            out.tags = route.groups;
        }

        out.description = Array.isArray(route.notes) ? route.notes.join('<br/><br/>') : route.notes;
       // out.responses = Utilities.hasProperties(route.responses)? route.responses : {'200': {'description': 'Successful'}};
       // out.responses = route.responses;


        if (route.security){
            out.security = route.security;
        }


        var payloadParameters;

        // set from plugin options or from route options
        var payloadType = settings.payloadType;
        if (route.payloadType){
            payloadType = route.payloadType;
        }

        // build payload either with JSON or form input
        if (payloadType && payloadType.toLowerCase() === 'json') {


            // set as json
            payloadParameters = Properties.parseProperty(null, route.payloadParams, swagger.definitions);
            var definitionName = internals.getJOIClassName(route.payloadParams);
            //console.log(JSON.stringify(payloadParameters))

            // override inline structure and use defination object
            if (payloadParameters && payloadParameters.type !== 'void'){
                payloadParameters.in = 'body';
                payloadParameters.name = 'body';
                payloadParameters.schema = {
                    '$ref': '#/definitions/' + Definitions.appendDefinition(
                        definitionName,
                        internals.getJOIObj(route, 'payloadParams'),
                        swagger.definitions,
                        out.operationId + '_payload'
                        )
                };
                delete payloadParameters.properties;
            }

        } else {
            payloadParameters = Properties.joiToSwaggerParameters( internals.getJOIObj(route, 'payloadParams'), 'formData', swagger.definitions );
        }

        out.parameters = out.parameters.concat(
            Properties.joiToSwaggerParameters( internals.getJOIObj(route, 'headerParams'), 'header', swagger.definitions ),
            Properties.joiToSwaggerParameters( internals.getJOIObj(route, 'pathParams'), 'path', swagger.definitions ),
            Properties.joiToSwaggerParameters( internals.getJOIObj(route, 'queryParams'), 'query', swagger.definitions )
        );
        if (payloadParameters){
            out.parameters = out.parameters.concat( payloadParameters );
        }


        out.responses = Responses.build( route.responses, route.responseSchema, route.responseStatus, swagger.definitions );

        /*
       var responseClassName = internals.getJOIClassName(route.responseSchema);
        if(responseClassName){
            if(!out.responses['200']){
                out.responses['200'] = {'description': 'Successful'}
            }
            out.responses['200'].schema = {
                '$ref': '#/definitions/' + Definitions.appendDefinition( responseClassName, route.responseSchema, swagger.definitions)
            }
        }

        if(route.responseStatus){
            console.log(JSON.stringify(route.responseStatus));
        }
        */


        if (!pathObj[path]){
            pathObj[path] = {};
        }
        pathObj[path][method.toLowerCase()] = out;


        //console.log(JSON.stringify(swagger.definitions))
    });

    swagger.paths = pathObj;
    return swagger;
};


// gets the JOI object from route object
internals.getJOIObj = function (route, name) {

    var prama = route[name];
    if (route[name] && route[name].isJoi) {
        if (route[name]._inner.children) {
            prama = route[name]._inner.children;
        } else {
            // for array types
            if (route[name]._type = 'array') {
                prama = route[name];
            }
        }
    }
    return prama;
};


/**
 * Given a JOI schema get its className
 *
 * @param  {Object} joiObj
 * @return {String || undefined}
 */
internals.getJOIClassName = function (joiObj) {

    if (joiObj && joiObj._meta && Array.isArray(joiObj._meta)){
        var i = joiObj._meta.length;
        while (i--) {
            if (joiObj._meta[i].className){
                return joiObj._meta[i].className;
            }
        }
    }
    return undefined;
};