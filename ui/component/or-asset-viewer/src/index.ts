// Declare require method which we'll use for importing webpack resources (using ES6 imports will confuse typescript parser)
declare function require(name: string): any;

import {customElement, html, LitElement, property, PropertyValues, query, TemplateResult, unsafeCSS} from "lit-element";
import "@openremote/or-icon";
import "@openremote/or-mwc-components/or-mwc-input";
import "@openremote/or-attribute-input";
import "@openremote/or-attribute-history";
import "@openremote/or-chart";
import "@openremote/or-survey";
import "@openremote/or-survey-results";
import "@openremote/or-table";
import "@openremote/or-panel";
import "@openremote/or-mwc-components/or-mwc-dialog";
import {showDialog, showOkCancelDialog} from "@openremote/or-mwc-components/or-mwc-dialog";
import "@openremote/or-mwc-components/or-mwc-list";
import {OrTranslate, translate} from "@openremote/or-translate";
import {InputType, OrInput, OrInputChangedEvent} from "@openremote/or-mwc-components/or-mwc-input";
import manager, {AssetModelUtil, subscribe, Util} from "@openremote/core";
import {OrTable} from "@openremote/or-table";
import {OrChartConfig, OrChartEvent} from "@openremote/or-chart";
import {HistoryConfig, OrAttributeHistory, OrAttributeHistoryEvent} from "@openremote/or-attribute-history";
import {
    AgentDescriptor,
    Asset,
    AssetEvent,
    Attribute,
    AttributeEvent,
    ClientRole,
    FileInfo,
    SharedEvent,
    WellknownAssets,
    WellknownAttributes,
    WellknownMetaItems
} from "@openremote/model";
import {panelStyles, style} from "./style";
import i18next, {TOptions, InitOptions} from "i18next";
import {styleMap} from "lit-html/directives/style-map";
import {classMap} from "lit-html/directives/class-map";
import { GenericAxiosResponse } from "axios";
import {OrIcon} from "@openremote/or-icon";
import "./or-edit-asset-panel";
import {OrEditAssetModifiedEvent} from "./or-edit-asset-panel";
import "@openremote/or-mwc-components/or-mwc-snackbar";
import {showSnackbar} from "@openremote/or-mwc-components/or-mwc-snackbar";

export interface PanelConfig {
    type?: "info" | "setup" | "history" | "group" | "survey" | "survey-results";
    title?: string;
    hide?: boolean;
    hideOnMobile?: boolean;
    panelStyles?: { [style: string]: string };
}

export interface InfoPanelItemConfig {
    label?: string;
    hideOnMobile?: boolean;
    readonly?: boolean;
    disabled?: boolean;
    disableButton?: boolean;
    disableHelperText?: boolean;
    inputTypeOverride?: InputType;
    priority?: number;
    styles?: { [style: string]: string };
}

export interface InfoPanelConfig extends PanelConfig {
    type: "info",
    attributes: {
        include?: string[];
        exclude?: string[];
        itemConfig?: {
            [name: string]: InfoPanelItemConfig;
        };
    },
    properties: {
        include?: string[];
        exclude?: string[];
        itemConfig?: {
            [name: string]: InfoPanelItemConfig;
        };
    }
}

export interface SetupPanelConfig extends PanelConfig {
    type: "setup"
}

export interface HistoryPanelConfig extends PanelConfig {
    type: "history",
    include?: string[];
    exclude?: string[];
}

export interface GroupPanelConfig extends PanelConfig {
    type: "group",
    childAssetTypes?: {
        [assetType: string]: {
            availableAttributes?: string[];
            selectedAttributes?: string[];
        }
    };
}

export type PanelConfigUnion = InfoPanelConfig | SetupPanelConfig | GroupPanelConfig | PanelConfig;
export type PanelViewProvider = (asset: Asset, attributes: { [index: string]: Attribute<any> }, panelName: string, hostElement: LitElement, viewerConfig: AssetViewerConfig, panelConfig: PanelConfigUnion) => TemplateResult | undefined;
export type PropertyViewProvider = (asset: Asset, property: string, value: any, hostElement: LitElement, viewerConfig: AssetViewerConfig, panelConfig: PanelConfigUnion) => TemplateResult | undefined;
export type AttributeViewProvider = (asset: Asset, attribute: Attribute<any>, hostElement: LitElement, viewerConfig: AssetViewerConfig, panelConfig: PanelConfigUnion) => TemplateResult | undefined;

export interface AssetViewerConfig {
    panels?: {[name: string]: PanelConfigUnion};
    viewerStyles?: { [style: string]: string };
    propertyViewProvider?: PropertyViewProvider;
    attributeViewProvider?: AttributeViewProvider;
    panelViewProvider?: PanelViewProvider;
    historyConfig?: HistoryConfig;
    chartConfig?: OrChartConfig;
}

export interface ViewerConfig {
    default?: AssetViewerConfig;
    assetTypes?: { [assetType: string]: AssetViewerConfig };
    historyConfig?: HistoryConfig;
}

export const DEFAULT_ASSET_PROPERTIES = [
    "name",
    "createdOn",
    "type",
    "parentId",
    "accessPublicRead"
];

export function getIncludedProperties(config?: InfoPanelConfig): string[] {
    const includedProperties = config && config.properties && config.properties.include ? config.properties.include : DEFAULT_ASSET_PROPERTIES;
    const excludedProperties =  config && config.properties && config.properties.exclude ? config.properties.exclude : [];

    return includedProperties.filter((prop) => !excludedProperties || excludedProperties.indexOf(prop) < 0);
}

export function getIncludedAttributes(attributes: { [index: string]: Attribute<any> }, config?: InfoPanelConfig): Attribute<any>[] {
    const includedAttributes = config && config.attributes && config.attributes.include ? config.attributes.include : undefined;
    const excludedAttributes = config && config.attributes && config.attributes.exclude ? config.attributes.exclude : undefined;
    if (includedAttributes || excludedAttributes) {
        return Object.values(attributes).filter((attr) =>
            (!includedAttributes || includedAttributes.some((inc) => Util.stringMatch(inc, attr.name!)))
            && (!excludedAttributes || !excludedAttributes.some((exc) => Util.stringMatch(exc, attr.name!))));
    }
    return Object.values(attributes);
}

class EventHandler {
    _callbacks: Function[];

    constructor() {
        this._callbacks = [];
    }

    startCallbacks() {
        return new Promise<void>((resolve, reject) => {
            if (this._callbacks && this._callbacks.length > 0) {
                this._callbacks.forEach(cb => cb());
            }
            resolve();
        })

    }

    addCallback(callback: Function) {
        this._callbacks.push(callback);
    }
}

export class OrAssetViewerComputeGridEvent extends CustomEvent<void> {

    public static readonly NAME = "or-asset-viewer-compute-grid-event";

    constructor() {
        super(OrAssetViewerComputeGridEvent.NAME, {
            bubbles: true,
            composed: true
        });
    }
}

export type SaveResult = {
    success: boolean,
    assetId: string,
    isNew?: boolean,
    isCopy?: boolean
};

export class OrAssetViewerRequestSaveEvent extends CustomEvent<Util.RequestEventDetail<Asset>> {

    public static readonly NAME = "or-asset-viewer-request-save";

    constructor(asset: Asset) {
        super(OrAssetViewerRequestSaveEvent.NAME, {
            bubbles: true,
            composed: true,
            detail: {
                allow: true,
                detail: asset
            }
        });
    }
}

export class OrAssetViewerSaveEvent extends CustomEvent<SaveResult> {

    public static readonly NAME = "or-asset-viewer-save";

    constructor(saveResult: SaveResult) {
        super(OrAssetViewerSaveEvent.NAME, {
            bubbles: true,
            composed: true,
            detail: saveResult
        });
    }
}

export class OrAssetViewerRequestEditToggleEvent extends CustomEvent<Util.RequestEventDetail<boolean>> {

    public static readonly NAME = "or-asset-viewer-request-edit-toggle";

    constructor(edit: boolean) {
        super(OrAssetViewerRequestEditToggleEvent.NAME, {
            bubbles: true,
            composed: true,
            detail: {
                allow: true,
                detail: edit
            }
        });
    }
}

export class OrAssetViewerEditToggleEvent extends CustomEvent<boolean> {

    public static readonly NAME = "or-asset-viewer-edit-toggle";

    constructor(edit: boolean) {
        super(OrAssetViewerEditToggleEvent.NAME, {
            bubbles: true,
            composed: true,
            detail: edit
        });
    }
}

declare global {
    export interface HTMLElementEventMap {
        [OrAssetViewerComputeGridEvent.NAME]: OrAssetViewerComputeGridEvent;
        [OrAssetViewerRequestSaveEvent.NAME]: OrAssetViewerRequestSaveEvent;
        [OrAssetViewerSaveEvent.NAME]: OrAssetViewerSaveEvent;
        [OrAssetViewerRequestEditToggleEvent.NAME]: OrAssetViewerRequestEditToggleEvent;
        [OrAssetViewerEditToggleEvent.NAME]: OrAssetViewerEditToggleEvent;
    }
}

const onRenderComplete = new EventHandler();

export function getPanel(name: string, panelConfig: PanelConfig, content: TemplateResult | undefined) {

    if (!content) {
        return;
    }

    return html`
        <div class=${classMap({panel: true, mobileHidden: panelConfig.hideOnMobile === true})} id="${name}-panel" style="${panelConfig && panelConfig.panelStyles ? styleMap(panelConfig.panelStyles) : ""}">
            <div class="panel-content-wrapper">
                <div class="panel-title">
                    <or-translate value="${panelConfig.title ? panelConfig.title : name}"></or-translate>
                </div>
                <div class="panel-content">
                    ${content}
                </div>
            </div>
        </div>
    `;
}

export function getPanelContent(panelName: string, asset: Asset, attributes: { [index: string]: Attribute<any> }, hostElement: LitElement, viewerConfig: AssetViewerConfig, panelConfig: PanelConfig): TemplateResult | undefined {

    // See if config has a custom way for rendering this panel
    if (viewerConfig.panelViewProvider) {
        const template = viewerConfig.panelViewProvider(asset, attributes, panelName, hostElement, viewerConfig, panelConfig);
        if (template) {
            return template;
        }
    }

    if (panelConfig && panelConfig.type === "info") {

        // This type of panel shows attributes and/or properties of the asset
        const infoConfig = panelConfig as InfoPanelConfig;
        const includedProperties = getIncludedProperties(infoConfig);
        const includedAttributes = getIncludedAttributes(attributes, infoConfig);

        if (includedProperties.length === 0 && includedAttributes.length === 0) {
            return undefined;
        }

        const items: {item: string | Attribute<any>, itemConfig: InfoPanelItemConfig}[] = [];

        includedProperties.forEach((prop) => {
            const itemConfig = infoConfig.properties && infoConfig.properties.itemConfig ? infoConfig.properties.itemConfig[prop] : {};
            if (itemConfig.label === undefined) {
                itemConfig.label = i18next.t(prop);
            }
            itemConfig.priority = itemConfig.priority || 0;
            items.push({
                item: prop,
                itemConfig: itemConfig
            });
        });

        includedAttributes.forEach((attribute) => {
            const itemConfig = infoConfig.attributes && infoConfig.attributes.itemConfig && infoConfig.attributes.itemConfig[attribute.name!] ? infoConfig.attributes.itemConfig[attribute.name!] : {};
            if (itemConfig.label === undefined) {
                // Get label here so we can sort the attributes
                const descriptors = AssetModelUtil.getAttributeAndValueDescriptors(asset.type!, attribute.name, attribute);
                itemConfig.label = Util.getAttributeLabel(attribute, descriptors[0], asset.type, true);
            }
            itemConfig.priority = itemConfig.priority || 0;
            items.push({
                item: attribute,
                itemConfig: itemConfig
            });
        });

        const labelSort = Util.sortByString((item: {item: string | Attribute<any>, itemConfig: InfoPanelItemConfig}) => item.itemConfig.label!.toUpperCase());

        items.sort((a, b) => {
            const priorityA = a.itemConfig.priority!;
            const priorityB = b.itemConfig.priority!;

            if (priorityA < priorityB) {
                return 1;
            }

            if (priorityA > priorityB) {
                return -1;
            }

            return labelSort(a,b);
        });

        return html`
            ${items.map((item) => {
                if (typeof item.item === "string") {
                    // This is a property                    
                    return getField(item.item, item.itemConfig, getPropertyTemplate(asset, item.item, hostElement, viewerConfig, panelConfig, item.itemConfig));
                } else {
                    // This is an attribute
                    return getField(item.item.name!, item.itemConfig, getAttributeTemplate(asset, item.item, hostElement, viewerConfig, panelConfig, item.itemConfig));
                }
        })}`;
    }

    if (panelConfig && panelConfig.type === "setup") {

        const descriptor = AssetModelUtil.getAssetDescriptor(asset.type) as AgentDescriptor;
        
        if (!descriptor || !asset.id || descriptor.descriptorType !== "agent" || !descriptor.assetDiscovery && !descriptor.assetImport) {
            return;
        }

        const updateFileName = () => {
            const fileInputElem = hostElement.shadowRoot!.getElementById('fileuploadElem') as HTMLInputElement,
                fileNameElem = hostElement.shadowRoot!.getElementById('filenameElem') as HTMLInputElement,
                str = fileInputElem.value;
            let i;
            if (str.lastIndexOf('\\')) {
                i = str.lastIndexOf('\\') + 1;
            } else if (str.lastIndexOf('/')) {
                i = str.lastIndexOf('/') + 1;
            }
            fileNameElem.value = str.slice(i, str.length);
        }
        
        const showAssetListDialog = (assets: Asset[]): void => {
            console.log('assets', assets);
            showDialog(
                {
                    title: i18next.t("assets"),
                    content: html`
                        <div style="display: grid">
                            ${assets.sort().map((asset: Asset) =>
                                html`<pre>${JSON.stringify(asset, null, 2)}</pre>`
                            )}
                        </div>
                    `,
                    actions: [
                        {
                            actionName: "cancel",
                            content: i18next.t("ok")
                        }
                    ],
                    styles: html`<style></style>`,
                    dismissAction: null
                }
            )
        }

        const discoverAssets = () => {
            manager.rest.api.AgentResource.doProtocolAssetDiscovery(asset.id!)
                .then(response => console.log(response.data, response)); //todo: do something with this response
        } 

        const fileToBase64 = () => {
            const mock = [{"id":"3TJkxdywN72VtPSRp9yh1P","version":2,"createdOn":1616764597169,"name":"Consoles","accessPublicRead":false,"realm":"master","type":"GroupAsset"},{"id":"6tl8lIwzacgxpf1dn2aYRd","version":767,"createdOn":1616764597322,"name":"Chrome","accessPublicRead":true,"parentId":"3TJkxdywN72VtPSRp9yh1P","realm":"master","type":"ConsoleAsset"},{"id":"4A1zzjMl2RSZP5hkAPTHXY","version":1,"createdOn":1616766737542,"name":"batterij","accessPublicRead":false,"parentId":"6tl8lIwzacgxpf1dn2aYRd","realm":"master","type":"ElectricityBatteryAsset"},{"id":"6mcvIEsIF3eJWNALxoCzeb","version":1,"createdOn":1616766752449,"name":"powerpomp","accessPublicRead":false,"parentId":"6tl8lIwzacgxpf1dn2aYRd","realm":"master","type":"ElectricityChargerAsset"},{"id":"3k5FSBmIPg71IFzra3yMer","version":1,"createdOn":1616766852381,"name":"stad","accessPublicRead":false,"parentId":"6tl8lIwzacgxpf1dn2aYRd","realm":"master","type":"CityAsset"},{"id":"6x9cDih9QrSdjqQeKLOIii","version":0,"createdOn":1616772127180,"name":"New Asset","accessPublicRead":false,"parentId":"6mcvIEsIF3eJWNALxoCzeb","realm":"master","type":"BuildingAsset"},{"id":"4sG7sVy0EYriEIqDKi6a7b","version":8,"createdOn":1616772814609,"name":"Chrome","accessPublicRead":true,"parentId":"3TJkxdywN72VtPSRp9yh1P","realm":"master","type":"ConsoleAsset"},{"id":"73NV3R6mLr3LRuc93Z1I5r","version":0,"createdOn":1616775727004,"name":"New Asset","accessPublicRead":false,"parentId":"4sG7sVy0EYriEIqDKi6a7b","realm":"master","type":"HttpClientAgent"},{"id":"5VsNXHeSHEIgua76oWwnIp","version":0,"createdOn":1618574473883,"name":"New Asset","accessPublicRead":false,"realm":"master","type":"DoorSensorAsset"},{"id":"6FEa1cS2DIuSz9TFxRQt3c","version":0,"createdOn":1618574509214,"name":"New Asset","accessPublicRead":false,"parentId":"5VsNXHeSHEIgua76oWwnIp","realm":"master","type":"DoorSensorAsset"},{"id":"3m32v2V3pNp1RRWqsuYlGF","version":0,"createdOn":1618575178044,"name":"New Asset","accessPublicRead":false,"parentId":"6FEa1cS2DIuSz9TFxRQt3c","realm":"master","type":"DoorSensorAsset"},{"id":"4uM0HouAH1agGR6eLOstOu","version":0,"createdOn":1618575292573,"name":"New Asset","accessPublicRead":false,"parentId":"3m32v2V3pNp1RRWqsuYlGF","realm":"master","type":"DoorSensorAsset"},{"id":"2n30IO4tQkRneHuz4ReGSs","version":0,"createdOn":1618575426408,"name":"New Asset","accessPublicRead":false,"realm":"master","type":"DoorSensorAsset"},{"id":"4kBTSEp2h3hr1rkBxb76TF","version":0,"createdOn":1618575500002,"name":"New Asset","accessPublicRead":false,"parentId":"2n30IO4tQkRneHuz4ReGSs","realm":"master","type":"GroupAsset"},{"id":"7aYWP2WkkHepJMAexTQkqy","version":0,"createdOn":1618576890187,"name":"New Asset","accessPublicRead":false,"parentId":"5VsNXHeSHEIgua76oWwnIp","realm":"master","type":"DoorSensorAsset"},{"id":"58OmsO6EatYfg6uvdRfsTF","version":0,"createdOn":1618576901654,"name":"New Asset","accessPublicRead":false,"parentId":"7aYWP2WkkHepJMAexTQkqy","realm":"master","type":"DoorSensorAsset"},{"id":"5QR6s7Amjm8WV2BNxAGPFt","version":0,"createdOn":1618578329894,"name":"New Asset","accessPublicRead":false,"parentId":"7aYWP2WkkHepJMAexTQkqy","realm":"master","type":"DoorSensorAsset"},{"id":"73TiWF7bdN8tJ1ijf5i57S","version":0,"createdOn":1618578340921,"name":"New Asset","accessPublicRead":false,"parentId":"5QR6s7Amjm8WV2BNxAGPFt","realm":"master","type":"BuildingAsset"},{"id":"7MTBpFxc2YYs9ioApcumBV","version":0,"createdOn":1619167161434,"name":"New Asset","accessPublicRead":false,"parentId":"2n30IO4tQkRneHuz4ReGSs","realm":"master","type":"KNXAgent"},{"id":"2mUELFOHFKq2AN9nhwzn4v","version":2,"createdOn":1619178641526,"name":"zw","accessPublicRead":false,"realm":"master","type":"ZWAgent"},{"id":"3fCRBvN9WvzYAgVOjjhe9p","version":1,"createdOn":1619178780493,"name":"knx","accessPublicRead":false,"realm":"master","type":"KNXAgent"}];
            showAssetListDialog(mock as Asset[]); //todo: remove this
            const fileInputElem = hostElement.shadowRoot!.getElementById('fileuploadElem') as HTMLInputElement;
            if (fileInputElem) {
                const reader = new FileReader();
                if (fileInputElem.files && fileInputElem.files.length) {
                    reader.readAsDataURL(fileInputElem.files[0]); //convert to base64
                }
                
                reader.onload = () => {
                    if (!reader.result) {
                        // TODO: DO SOMETHING HERE
                    } else {
                        let encoded = reader.result.toString().replace(/^data:(.*,)?/, '');
                        if ((encoded.length % 4) > 0) {
                            encoded += '='.repeat(4 - (encoded.length % 4));
                        }
                        const fileInfo = {
                            name: 'filename',
                            contents: encoded,
                            binary: true
                        } as FileInfo

                        manager.rest.api.AgentResource.doProtocolAssetImport(asset.id!, fileInfo) //todo: this doesn't work yet
                            .then(response => {
                                if (response.status !== 200) {
                                    showSnackbar(undefined, "Something went wrong, please try again", i18next.t("dismiss"));
                                } else {
                                    console.info(response.data, response) //todo: do something with this response
                                    showAssetListDialog(response.data as Asset[]);
                                }
                            })
                            .catch(() => showSnackbar(undefined, "Something went wrong, please try again", i18next.t("dismiss")));
                  
                    }
                }
            }
        }
        
        let content: TemplateResult = html``;

        if (descriptor.assetImport) {
            content = html`
                <div id="fileupload"> 
                    <or-mwc-input outlined .label="${i18next.t("selectFile")}" .type="${InputType.BUTTON}" @click="${() => hostElement.shadowRoot!.getElementById('fileuploadElem')!.click()}">
                        <input id="fileuploadElem" name="configfile" type="file" accept=".json, .knxproj, .vlp" @change="${() => updateFileName()}"/>
                    </or-mwc-input>
                    <or-mwc-input id="filenameElem" .type="${InputType.TEXT}" disabled></or-mwc-input>
                    <or-mwc-input icon="upload" .type="${InputType.BUTTON}" @click="${() => fileToBase64()}"></or-mwc-input>
                </div>
            `;
        }
        else if (descriptor.assetDiscovery) {
            content = html`<or-mwc-input outlined id="discover-btn" .type="${InputType.BUTTON}" .label="${i18next.t("discoverAssets")}" @click="${() => discoverAssets()}"></or-mwc-input>`;
        } else {
            showSnackbar(undefined, "agent type doesn't support a known protocol to add assets", i18next.t("dismiss"));
        }
        
        return html`      
            ${content}
        `;
        
    }

    if (panelConfig && panelConfig.type === "survey") {
        return html`      
            <or-survey id="survey" .surveyId="${asset.id}"></or-survey>
        `;
    }

    if (panelConfig && panelConfig.type === "survey-results") {
        return html`     
            <or-survey-results id="survey-results" .survey="${asset}"></or-survey-results>
        `;
    }

    if (panelConfig && panelConfig.type === "history") {
        // Special handling for history panel which shows an attribute selector and a graph/data table of historical values
        const historyConfig = panelConfig as HistoryPanelConfig;
        const includedAttributes = historyConfig.include ? historyConfig.include : undefined;
        const excludedAttributes = historyConfig.exclude ? historyConfig.exclude : [];
        const historyAttrs = Object.values(attributes).filter((attr) =>
            (!includedAttributes || includedAttributes.indexOf(attr.name!) >= 0)
            && (!excludedAttributes || excludedAttributes.indexOf(attr.name!) < 0)
            && (attr.meta && (attr.meta.hasOwnProperty(WellknownMetaItems.STOREDATAPOINTS) ? attr.meta[WellknownMetaItems.STOREDATAPOINTS] : attr.meta.hasOwnProperty(WellknownMetaItems.AGENTLINK))));

        if (historyAttrs.length === 0) {
            return undefined;
        }

        const attributeChanged = (attributeName: string) => {
            if (hostElement.shadowRoot) {
                const attributeHistory = hostElement.shadowRoot.getElementById("attribute-history") as OrAttributeHistory;

                if (attributeHistory) {

                    let attribute: Attribute<any> | undefined;

                    if (attributeName) {
                        attribute = asset.attributes && asset.attributes![attributeName];
                    }

                    attributeHistory.attribute = attribute;
                }
            }
        };

        const options = historyAttrs.map((attr) => {
            const descriptors = AssetModelUtil.getAttributeAndValueDescriptors(asset.type, attr.name, attr);
            const label = Util.getAttributeLabel(attr, descriptors[0], asset.type, true);
            return [attr.name, label];
        });
        const attrName: string = historyAttrs[0].name!;
        onRenderComplete.addCallback(() => attributeChanged(attrName));
        return html`
            <style>
               or-attribute-history{
                    min-height: 70px;
                    width: 100%;
               }
                #history-controls {
                    flex: 0;
                    margin-bottom: 10px;
                    position: absolute;
                }
                
                #history-attribute-picker {
                    flex: 0;
                    width: 200px;
                }
                
                or-attribute-history {
                    --or-attribute-history-controls-margin: 0 0 20px 204px;  
                }
                
                @media screen and (max-width: 2028px) {
                  #history-controls {
                        position: unset;
                        margin: 0 0 10px 0;
                  }
                  
                  or-attribute-history {
                        --or-attribute-history-controls-margin: 10px 0 0 0;  
                        --or-attribute-history-controls-margin-children: 0 20px 20px 0;
                  }
                }
            </style>
            <div id="history-controls">
                <or-mwc-input id="history-attribute-picker" .checkAssetWrite="${false}" .value="${historyAttrs[0].name}" .label="${i18next.t("attribute")}" @or-mwc-input-changed="${(evt: OrInputChangedEvent) => attributeChanged(evt.detail.value)}" .type="${InputType.SELECT}" .options="${options}"></or-mwc-input>
            </div>        
            <or-attribute-history id="attribute-history" .config="${viewerConfig.historyConfig}" .assetType="${asset.type}" .assetId="${asset.id}"></or-attribute-history>
        `;
    }

    if (panelConfig && panelConfig.type === "group") {

        if (asset.type !== "GroupAsset") {
            return;
        }

        // Get child asset type attribute value
        const childAssetTypeAttribute = asset.attributes && asset.attributes[WellknownAttributes.CHILDASSETTYPE];
        const groupConfig = panelConfig as GroupPanelConfig;

        if (!childAssetTypeAttribute || typeof childAssetTypeAttribute.value !== "string") {
            return;
        }
        const childAssetType = childAssetTypeAttribute.value as string;
        let childAssets: Asset[] = [];

        // Determine available and selected attributes for the child asset type
        let availableAttributes: string[] = [];
        let selectedAttributes: string[] = [];

      
        if (groupConfig.childAssetTypes && groupConfig.childAssetTypes[childAssetType]) {
            availableAttributes = groupConfig.childAssetTypes[childAssetType].availableAttributes ? groupConfig.childAssetTypes[childAssetType].availableAttributes! : [];
            selectedAttributes = groupConfig.childAssetTypes[childAssetType].selectedAttributes ? groupConfig.childAssetTypes[childAssetType].selectedAttributes! : [];
        }
        const configStr = window.localStorage.getItem('OrAssetConfig')
        const viewSelector = asset.id ? asset.id : window.location.hash;
        if(configStr) {
            const config = JSON.parse(configStr);
            const view = config.views[viewSelector];
            if(view) {
                selectedAttributes = [...view]
            }
        }
        // Get available and selected attributes from asset descriptor if not defined in config
        if (availableAttributes.length === 0) {
            const descriptor = AssetModelUtil.getAssetTypeInfo(childAssetType);
            if (descriptor && descriptor.attributeDescriptors) {
                availableAttributes = descriptor.attributeDescriptors.map((desc) => desc.name!);
            }
        }
        if ((!selectedAttributes || selectedAttributes.length === 0) && availableAttributes) {
            selectedAttributes = [...availableAttributes];
        }

        const attributePickerModalOpen = () => {

            const newlySelectedAttributes = [...selectedAttributes];

            showOkCancelDialog(
                i18next.t("addRemoveAttributes"),
                html`
                    <div style="display: grid">
                        ${availableAttributes.sort().map((attribute) =>
                            html`<div style="grid-column: 1 / -1;">
                                    <or-mwc-input .type="${InputType.CHECKBOX}" .label="${i18next.t(attribute)}" .value="${!!selectedAttributes.find((selected) => selected === attribute)}"
                                        @or-mwc-input-changed="${(evt: OrInputChangedEvent) => evt.detail.value ? newlySelectedAttributes.push(attribute) : newlySelectedAttributes.splice(newlySelectedAttributes.findIndex((s) => s === attribute), 1)}"></or-mwc-input>
                                </div>`)}
                    </div>
                `
            ).then((ok) => {
                if (ok) {
                    selectedAttributes.length = 0;
                    selectedAttributes.push(...newlySelectedAttributes);
                    updateTable();
                }
            });
        };

        // Function to update the table and message when assets or config changes
        const updateTable = () => {

            const loadingMsg: OrTranslate = hostElement.shadowRoot!.getElementById(panelName + "-attribute-table-msg") as OrTranslate;
            const attributeTable: OrTable = hostElement.shadowRoot!.getElementById(panelName + "-attribute-table") as OrTable;
            const addRemoveButton: OrIcon = hostElement.shadowRoot!.getElementById(panelName + "-add-remove-columns") as OrIcon;

            if (!loadingMsg || !attributeTable || !addRemoveButton) {
                return;
            }

            if (selectedAttributes.length === 0 || !childAssets || childAssets.length === 0) {
                loadingMsg.value = "noChildAssets";
                loadingMsg.hidden = false;
                attributeTable.hidden = true;
                addRemoveButton.classList.remove("active");
                return;
            }

            // Update table properties which will cause a re-render
            addRemoveButton.classList.add("active");
            loadingMsg.hidden = true;
            attributeTable.hidden = false;
            const headers = [...selectedAttributes].sort();
            attributeTable.headers = headers.map((attrName) => {
                const attributeDescriptor = AssetModelUtil.getAttributeDescriptor(attrName, childAssetType);
                return Util.getAttributeLabel(undefined, attributeDescriptor, asset.type, false);
            });
            attributeTable.headers.unshift(i18next.t("groupAssetName"));
            attributeTable.rows = childAssets.map((childAsset) => {
                // todo: it's only processing including selected headers here...
                // move this to the columnFilter option of the table
                const arr = headers.map((attributeName) => {
                    return childAsset.attributes![attributeName] ? childAsset.attributes![attributeName].value! as string : "";
                });
                arr.unshift(childAsset.name!);
                return arr;
            });

            let config;
            const configStr = window.localStorage.getItem('OrAssetConfig')
            if(configStr) {
                config = JSON.parse(configStr);
                if(asset.id) {
                    config.views[asset.id] = selectedAttributes;
                }
            } else {
                config = {
                    views: {
                        [asset.id!]: selectedAttributes
                    }
                }
            }
           

            const message = {
                provider: "STORAGE",
                action: "STORE",
                key: "OrAssetConfig",
                value: JSON.stringify(config)
    
            }
            manager.console._doSendProviderMessage(message)
            window.setTimeout(() => OrAssetViewer.generateGrid(hostElement.shadowRoot), 0);
        };

        // Load child assets async then update the table
        getAssetChildren(asset.id!, asset.attributes!.childAssetType.value).then((assetChildren) => {
            childAssets = assetChildren;
            updateTable();
        });

        // Define the DOM content for this panel
        return html`
                <style>
                    .asset-group-add-remove-button {
                        position: absolute;
                        top: 20px;
                        right: var(--internal-or-asset-viewer-panel-padding);
                        opacity: 0.5;
                    }
                    .asset-group-add-remove-button.active {
                        cursor: pointer;
                        opacity: 1;
                    }
                </style>
                <or-icon class="asset-group-add-remove-button" .id="${panelName}-add-remove-columns" icon="pencil" @click="${() => attributePickerModalOpen()}"></or-icon>
                <or-table hidden .id="${panelName}-attribute-table" .options="{stickyFirstColumn:true}"></or-table>
                <span><or-translate id="${panelName}-attribute-table-msg" value="loading"></or-translate></span>
            `;
    }

    return undefined;
}

export function getAttributeTemplate(asset: Asset, attribute: Attribute<any>, hostElement: LitElement, viewerConfig: AssetViewerConfig, panelConfig: PanelConfig, itemConfig: InfoPanelItemConfig) {
    if (viewerConfig.attributeViewProvider) {
        const result = viewerConfig.attributeViewProvider(asset, attribute, hostElement, viewerConfig, panelConfig);
        if (result) {
            return result;
        }
    }

    let attrLabel: string | undefined;
    let attrDisabled: boolean | undefined;
    let attrReadonly: boolean | undefined;
    let attrDisableButton: boolean | undefined;
    let attrInputType: InputType | undefined;
    let attrDisableHelper: boolean | undefined;

    if (itemConfig) {
        attrLabel = itemConfig.label;
        attrDisabled = itemConfig.disabled;
        attrReadonly = itemConfig.readonly;
        attrDisableButton = itemConfig.disableButton;
        attrDisableHelper = itemConfig.disableHelperText;
        attrInputType = itemConfig.inputTypeOverride;
    }

    return html`
        <or-attribute-input dense .assetType="${asset!.type}" .attribute="${attribute}" .assetId="${asset.id!}" .disabled="${attrDisabled}" .label="${attrLabel}" .readonly="${attrReadonly}" .disableButton="${attrDisableButton}" .inputType="${attrInputType}" .hasHelperText="${!attrDisableHelper}"></or-attribute-input>
    `;
}

export function getPropertyTemplate(asset: Asset, property: string, hostElement: LitElement, viewerConfig: AssetViewerConfig | undefined, panelConfig: PanelConfig | undefined, itemConfig: InfoPanelItemConfig) {
    let value = (asset as { [index: string]: any })[property];

    if (viewerConfig && viewerConfig.propertyViewProvider && panelConfig) {
        const result = viewerConfig.propertyViewProvider(asset, property, value, hostElement, viewerConfig, panelConfig);
        if (result) {
            return result;
        }
    }

    let type = InputType.TEXT;

    switch (property) {
        case "parentId":
            // Display the path instead
            value = (asset as { [index: string]: any })["path"];
            if (!value || !(Array.isArray(value))) {
                return;
            }

            // Populate value when we get the response
            const ancestors = [...value];
            ancestors.splice(0,1);
            value = "";
            if (ancestors.length > 0) {
                getAssetNames(ancestors).then(
                    (names) => {
                        if (hostElement && hostElement.shadowRoot) {
                            const pathField = hostElement.shadowRoot.getElementById("property-parentId") as OrInput;
                            if (pathField) {
                                pathField.value = names.reverse().join(" > ");
                            }
                        }
                    }
                );
                value = i18next.t("loading");
            }
            break;
        case "createdOn":
            type = InputType.DATETIME;
            break;
        case "accessPublicRead":
            type = InputType.CHECKBOX;
            break;
    }

    return html`<or-mwc-input id="property-${property}" .type="${type}" dense .value="${value}" .readonly="${itemConfig.readonly !== undefined ? itemConfig.readonly : true}" .label="${itemConfig.label}"></or-mwc-input>`;
}

export function getField(name: string, itemConfig?: InfoPanelItemConfig, content?: TemplateResult): TemplateResult {
    if (!content) {
        return html``;
    }

    return html`
            <div id="field-${name}" style="${itemConfig && itemConfig.styles ? styleMap(itemConfig.styles) : ""}" class=${classMap({field: true, mobileHidden: !!itemConfig && !!itemConfig.hideOnMobile})}>
                ${content}
            </div>
        `;
}

async function getAssetNames(ids: string[]): Promise<string[]> {
    const response = await manager.rest.api.AssetResource.queryAssets({
        select: {
            excludePath: true,
            excludeParentInfo: true,
            excludeAttributes: true
        },
        ids: ids
    });

    if (response.status !== 200 || !response.data || response.data.length !== ids.length) {
        return ids;
    }

    return ids.map((id) => response.data.find((asset) => asset.id === id)!.name!);
}

async function getAssetChildren(id: string, childAssetType: string): Promise<Asset[]> {
    let response: GenericAxiosResponse<Asset[]>;

    try {
        response = await manager.rest.api.AssetResource.queryAssets({
            select: {
                excludePath: true,
                excludeParentInfo: true
            },
            parents: [
                {
                    id: id
                }
            ]
        });
    } catch (e) {
        console.log("Failed to get child assets: " + e);
        return [];
    }

    if (response.status !== 200 || !response.data) {
        return [];
    }

    return response.data.filter((asset) => asset.type === childAssetType);
}

export async function saveAsset(asset: Asset): Promise<SaveResult> {

    const isUpdate = !!asset.id && asset.version !== undefined;
    let success: boolean;
    let id: string = "";

    try {
        if (isUpdate) {
            if (!asset.id) {
                throw new Error("Request to update existing asset but asset ID is not set");
            }
            const response = await manager.rest.api.AssetResource.update(asset.id!, asset);
            success = response.status === 204;
            if (success) {
                id = asset.id!;
            }
        } else {
            const response = await manager.rest.api.AssetResource.create(asset);
            success = response.status === 200;
            if (success) {
                id = response.data.id!;
            }
        }
    } catch (e) {
        success = false;
        showSnackbar(undefined, i18next.t("createAssetFailed"), i18next.t("dismiss"));
        console.error("Failed to save asset", e);
    }

    return {
        assetId: id,
        success: success,
        isNew: !isUpdate
    };
}

// TODO: Add webpack/rollup to build so consumers aren't forced to use the same tooling
const tableStyle = require("@material/data-table/dist/mdc.data-table.css");

@customElement("or-asset-viewer")
export class OrAssetViewer extends subscribe(manager)(translate(i18next)(LitElement)) {

    public static DEFAULT_VIEWER_CONFIG: AssetViewerConfig = {
        viewerStyles: {

        },
        panels: {
            group: {
                type: "group",
                title: "underlyingAssets"
            },
            info: {
                type: "info",
                hideOnMobile: true,
                properties: {
                    include:[]
                },
                attributes: {
                    include: ["notes", "manufacturer", "model"]
                }
            },
            setup: {
                type: "setup",
                title: "setup",
                hideOnMobile: false
            },
            location: {
                type: "info",
                properties: {
                    include:[]
                },
                attributes: {
                    include: ["location"],
                    itemConfig: {
                        location: {
                            label: "",
                            readonly: true
                        }
                    }
                }
            },
            attributes: {
                type: "info",
                properties: {
                    include:[]
                },
                attributes: {
                    exclude: ["location", "notes", "manufacturer", "model", "status"]
                }
            },
            history: {
                type: "history"
            }
        }
    };

    static get styles() {
        return [
            unsafeCSS(tableStyle),
            panelStyles,
            style
        ];
    }

    @property({type: Object, reflect: false})
    public asset?: Asset;

    @property({type: String})
    public assetId?: string;

    @property({type: Object})
    public config?: ViewerConfig;

    @property({type: Boolean})
    public editMode?: boolean;

    @property({type: Boolean})
    public readonly?: boolean;

    @property()
    protected _loading: boolean = false;

    protected _assetModified = false;
    protected _viewerConfig?: AssetViewerConfig;
    protected _attributes?: { [index: string]: Attribute<any> };
    protected resizeHandler = () => OrAssetViewer.generateGrid(this.shadowRoot);

    @query("#wrapper")
    protected wrapperElem!: HTMLDivElement;

    @query("#save-btn")
    protected saveBtnElem!: OrInput;

    @query("#edit-btn")
    protected editBtnElem!: OrInput;

    constructor() {
        super();
        this.addEventListener(OrAssetViewerComputeGridEvent.NAME, () => OrAssetViewer.generateGrid(this.shadowRoot));
        this.addEventListener(OrChartEvent.NAME, () => OrAssetViewer.generateGrid(this.shadowRoot));
        this.addEventListener(OrAttributeHistoryEvent.NAME, () => OrAssetViewer.generateGrid(this.shadowRoot));
        this.addEventListener(OrEditAssetModifiedEvent.NAME, () => this._onAssetModified());
    }

    public isModified() {
        return !!this.editMode && this._assetModified;
    }

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener("resize", this.resizeHandler);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener("resize", this.resizeHandler);
    }

    shouldUpdate(changedProperties: PropertyValues): boolean {

        if (this._isReadonly()) {
            this.editMode = false;
        }

        if (changedProperties.has("asset")) {
            this._viewerConfig = undefined;
            this._attributes = undefined;

            if (this.asset) {
                if (!this.asset.attributes) {
                    this.asset.attributes = {};
                }
                this._viewerConfig = this._getPanelConfig(this.asset);
                this._attributes = this.asset.attributes;
                this._assetModified = !this.asset.id;
            }
        }

        return super.shouldUpdate(changedProperties);
    }

    protected render(): TemplateResult | void {

        if (this._loading) {
            return html`
                <div class="msg"><or-translate value="loading"></or-translate></div>
            `;
        }

        if (!this.asset && !this.assetId) {
            return html`
                <div class="msg"><or-translate value="noAssetSelected"></or-translate></div>
            `;
        }

        if (!this.asset) {
            return html`
                <div><or-translate value="notFound"></or-translate></div>
            `;
        }

        if (!this._attributes || !this._viewerConfig) {
            return html``;
        }

        const descriptor = AssetModelUtil.getAssetDescriptor(this.asset!.type!);
        const editMode = !!this.editMode;

        let content: TemplateResult | string = ``;

        if (editMode) {
            content = html`
                <div id="edit-container">
                    <or-edit-asset-panel .asset="${this.asset}"></or-edit-asset-panel>
                </div>
            `;
        } else {
            if (this._viewerConfig.panels) {
                content = html`                
                    <div id="view-container" style="${this._viewerConfig.viewerStyles ? styleMap(this._viewerConfig.viewerStyles) : ""}">
                        ${Object.entries(this._viewerConfig.panels).map(([name, panelConfig]) => {
        
                            if (panelConfig.hide) {
                                return ``;
                            }
        
                            return getPanel(name, panelConfig, getPanelContent(name, this.asset!, this._attributes!, this, this._viewerConfig!, panelConfig)) || ``;
                        })}
                    </div>`;
            }
        }

        return html`
            <div id="wrapper">
                <div id="asset-header">
                    <a class="back-navigation" @click="${() => window.history.back()}">
                        <or-icon icon="chevron-left"></or-icon>
                    </a>
                    <div id="title">
                        <or-icon title="${descriptor && descriptor.name ? descriptor.name : "unset"}" style="--or-icon-fill: ${descriptor && descriptor.colour ? "#" + descriptor.colour : "unset"}" icon="${descriptor && descriptor.icon ? descriptor.icon : AssetModelUtil.getAssetDescriptorIcon(WellknownAssets.THINGASSET)}"></or-icon>
                        ${editMode ? html`<or-mwc-input id="name-input" .type="${InputType.TEXT}" min="1" max="1023" comfortable required outlined .label="${i18next.t("name")}" .value="${this.asset.name}" @or-mwc-input-changed="${(e: OrInputChangedEvent) => {this.asset!.name = e.detail.value; this._onAssetModified();}}"></or-mwc-input>` : html`<span>${this.asset.name}</span>`}
                    </div>
                    ${!this._isReadonly() ? html`
                        <span id="edit-wrapper" class="mobileHidden">
                            <or-translate value="editAsset"></or-translate>
                            <or-mwc-input id="edit-btn" .type="${InputType.SWITCH}" .value="${this.editMode}" @or-mwc-input-changed="${(ev: OrInputChangedEvent) => this._onEditToggleClicked(ev.detail.value)}"></or-mwc-input>
                        </span>
                    `: ``}
                    <div id="right-wrapper" class="mobileHidden">
                        ${this.asset!.createdOn ? html`<or-translate id="created-time" value="createdOnWithDate" .options="${{ date: new Date(this.asset!.createdOn!) } as TOptions<InitOptions>}"></or-translate>` : ``}
                        ${editMode ? html`<or-mwc-input id="save-btn" .disabled="${!this.isModified()}" raised .type="${InputType.BUTTON}" .label="${i18next.t("save")}" @or-mwc-input-changed="${() => this._onSaveClicked()}"></or-mwc-input>` : ``}
                    </div>
                </div>
                ${content}
            </div>
        `;
    }

    protected updated(_changedProperties: PropertyValues) {
        super.updated(_changedProperties);

        if (_changedProperties.has("assetId")) {
            this.asset = undefined;
            if (this.assetId) {
                this._loading = true;
                super.assetIds = [this.assetId];
            } else {
                this._loading = false;
                super.assetIds = undefined;
            }
        } else if (_changedProperties.has("editMode") && !this.editMode) {
            this.reloadAsset();
        }

        this.onCompleted().then(() => {
            onRenderComplete.startCallbacks().then(() => {
                OrAssetViewer.generateGrid(this.shadowRoot);
            });
        });
    }

    public reloadAsset() {
        this.asset = undefined;
        this._assetModified = false;
        if (this.assetId) {
            this._loading = true;
            super._refreshEventSubscriptions();
        }
    }

    protected _isReadonly() {
        return this.readonly || !manager.hasRole(ClientRole.WRITE_ASSETS);
    }

    async onCompleted() {
        await this.updateComplete;
    }

    protected _onEditToggleClicked(edit: boolean) {
        Util.dispatchCancellableEvent(
            this,
            new OrAssetViewerRequestEditToggleEvent(edit)).then(
                (detail) => {
                    if (detail.allow) {
                        this._doEditToggle(edit);
                    } else {
                        this.editBtnElem.value = !edit;
                    }
                });
    }

    protected _doEditToggle(edit: boolean) {
        this.editMode = edit;
        this.dispatchEvent(new OrAssetViewerEditToggleEvent(edit));
    }

    protected _onSaveClicked() {
        if (!this.asset) {
            return;
        }

        Util.dispatchCancellableEvent(this, new OrAssetViewerRequestSaveEvent(this.asset))
            .then((detail) => {
                if (detail.allow) {
                    this._doSave();
                }
            });
    }

    protected async _doSave() {
        let asset = this.asset;

        if (!asset) {
            return;
        }

        this.saveBtnElem.disabled = true;
        this.wrapperElem.classList.add("saving");

        const result = await saveAsset(asset);

        this.wrapperElem.classList.remove("saving");
        this.saveBtnElem.disabled = false;

        if (result.success) {
            this._assetModified = false;
            this.assetId = result.assetId;
            this.reloadAsset();
        }

        this.dispatchEvent(new OrAssetViewerSaveEvent(result));
    }

    protected _onAssetModified() {
        this._assetModified = true;
        this.requestUpdate();
    }

    public static generateGrid(shadowRoot: ShadowRoot | null) {
        if (shadowRoot) {
            const grid = shadowRoot.querySelector('#view-container');
            if (grid) {
                const rowHeight = parseInt(window.getComputedStyle(grid).getPropertyValue('grid-auto-rows'), 10);
                const rowGap = parseInt(window.getComputedStyle(grid).getPropertyValue('grid-row-gap'), 10);
                const items = shadowRoot.querySelectorAll('.panel');
                if (items) {
                    items.forEach((item) => {
                        const content = item.querySelector('.panel-content-wrapper');
                        if (content) {
                            const rowSpan = Math.ceil((content.getBoundingClientRect().height + rowGap) / (rowHeight + rowGap));
                            (item as HTMLElement).style.gridRowEnd = "span " + rowSpan;
                        }
                    });
                }
            }
        }
    }

    // TODO: Add debounce in here to minimise render calls
    _onEvent(event: SharedEvent) {
        if (event.eventType === "asset") {
            const asset = (event as AssetEvent).asset!;
            if (asset.id !== this.assetId) {
                return;
            }
            this.asset = asset;
            this._loading = false;
            return;
        }

        if (event.eventType === "attribute") {
            const attributeEvent = event as AttributeEvent;
            if (attributeEvent.attributeState!.ref!.id !== this.assetId) {
                return;
            }
            const attrName = attributeEvent.attributeState!.ref!.name!;

            if (this.asset && this.asset.attributes && this.asset.attributes.hasOwnProperty(attrName)) {
                if (attributeEvent.attributeState!.deleted) {
                    delete this.asset.attributes[attrName];
                    this.asset = {...this.asset};
                }
            }
        }
    }

    protected _getPanelConfig(asset: Asset): AssetViewerConfig {
        const config = {...OrAssetViewer.DEFAULT_VIEWER_CONFIG};

        if (this.config) {

            config.viewerStyles = {...config.viewerStyles};
            config.panels = {...config.panels};
            const assetConfig = this.config.assetTypes && this.config.assetTypes.hasOwnProperty(asset.type!) ? this.config.assetTypes[asset.type!] : this.config.default;

            if (assetConfig) {

                if (assetConfig.viewerStyles) {
                    Object.assign(config.viewerStyles, assetConfig.viewerStyles);
                }

                if (assetConfig.panels) {
                    Object.entries(assetConfig.panels).forEach(([name, assetPanelConfig]) => {
                        if (config.panels!.hasOwnProperty(name)) {
                            const panelStyles = {...config.panels![name].panelStyles};
                            config.panels![name] = Object.assign(config.panels![name], {...assetPanelConfig});
                            config.panels![name].panelStyles = Object.assign(panelStyles, assetPanelConfig.panelStyles);
                        } else {
                            config.panels![name] = {...assetPanelConfig};
                        }
                    });
                }

                config.attributeViewProvider = assetConfig.attributeViewProvider || (this.config.default ? this.config.default.attributeViewProvider : undefined);
                config.panelViewProvider = assetConfig.panelViewProvider || (this.config.default ? this.config.default.panelViewProvider : undefined);
                config.propertyViewProvider = assetConfig.propertyViewProvider || (this.config.default ? this.config.default.propertyViewProvider : undefined);
                config.historyConfig = assetConfig.historyConfig || this.config.historyConfig;
            }
        }
        return config;
    }
}
