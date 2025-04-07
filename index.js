// 필요한 SillyTavern 및 확장 API 함수 import
import { getContext, saveMetadataDebounced, renderExtensionTemplateAsync } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';

// 확장 이름 정의 (로그 및 식별용)
const EXTENSION_NAME = 'PresetTrackerEnhanced';

// 채팅 메타데이터에 프리셋 정보를 저장할 때 사용할 키
// 형식: { "정규화된send_date_model_정규화된model": Object }
const METADATA_KEY = 'presetsBySwipeKey';

// 불필요 데이터 정리 작업 진행 상태를 추적하는 플래그
let isCleaningInProgress = false;
// 가장 최근에 수집된 프리셋 정보를 임시 저장하는 변수 (키와 값 객체)
let latestPresetInfo = { key: null, value: null }; // value는 항상 객체 또는 null

// --- Helper 함수: 현재 UI에서 선택된 컨텍스트 템플릿 이름 가져오기 ---
function _getSelectedContextTemplateName() {
    const DEBUG_PREFIX = `[${EXTENSION_NAME} - ContextTemplate Helper]`;
    let selectedName = null; // 기본값을 null로 변경 (명시적 실패 표현)
    try {
        const $selectElement = $('#context_presets');
        if ($selectElement.length === 1) {
            const $selectedOption = $selectElement.find('option:selected');
            if ($selectedOption.length === 1) {
                selectedName = $selectedOption.text();
                // 기본적인 유효성 검사 (빈 값 또는 플레이스홀더 제외)
                if (!selectedName || selectedName.startsWith('---') || selectedName.startsWith('(')) {
                    selectedName = null; // 유효하지 않으면 null 처리
                }
            }
        } else {
            console.error(`${DEBUG_PREFIX} Error: Found ${$selectElement.length} elements with ID #context_presets.`);
        }
    } catch (error) {
        console.error(`${DEBUG_PREFIX} Error extracting context template name:`, error);
        selectedName = null; // 오류 시 null
    }
    // 최종 반환 전 null이면 실패 로그 (선택적)
    // if (selectedName === null) console.log(`${DEBUG_PREFIX} Could not get a valid context template name.`);
    return selectedName;
}

// --- Helper 함수: 현재 UI에서 선택된 지시 템플릿 이름 가져오기 ---
function _getSelectedInstructTemplateName() {
    const DEBUG_PREFIX = `[${EXTENSION_NAME} - InstructTemplate Helper]`;
    let selectedName = null;
    try {
        const $selectElement = $('#instruct_presets');
        if ($selectElement.length === 1) {
            const $selectedOption = $selectElement.find('option:selected');
            if ($selectedOption.length === 1) {
                selectedName = $selectedOption.text();
                if (!selectedName || selectedName.startsWith('---') || selectedName.startsWith('(')) {
                    selectedName = null;
                }
            }
        } else {
            console.error(`${DEBUG_PREFIX} Error: Found ${$selectElement.length} elements with ID #instruct_presets.`);
        }
    } catch (error) {
        console.error(`${DEBUG_PREFIX} Error extracting instruct template name:`, error);
        selectedName = null;
    }
    // if (selectedName === null) console.log(`${DEBUG_PREFIX} Could not get a valid instruct template name.`);
    return selectedName;
}

// --- Helper 함수: 현재 UI에서 선택된 시스템 프롬프트 이름 가져오기 ---
function _getSelectedSystemPromptName() {
    const DEBUG_PREFIX = `[${EXTENSION_NAME} - SystemPrompt Helper]`;
    let selectedName = null;
    try {
        const $selectElement = $('#sysprompt_select');
        if ($selectElement.length === 1) {
            const $selectedOption = $selectElement.find('option:selected');
            if ($selectedOption.length === 1) {
                selectedName = $selectedOption.text();
                // 시스템 프롬프트는 "None"이 유효한 값일 수 있으므로, 조금 다른 유효성 검사
                if (selectedName === null || selectedName === undefined || selectedName.startsWith('(')) {
                   selectedName = null; // 명백히 유효하지 않은 경우만 null
                }
                // "None"은 유효하므로 그대로 둠.
            }
        } else {
             console.error(`${DEBUG_PREFIX} Error: Found ${$selectElement.length} elements with ID #sysprompt_select.`);
        }
    } catch (error) {
        console.error(`${DEBUG_PREFIX} Error extracting system prompt name:`, error);
        selectedName = null;
    }
    // if (selectedName === null) console.log(`${DEBUG_PREFIX} Could not get a valid system prompt name.`);
    return selectedName;
}


// --- Helper 함수: 현재 UI에서 선택된 프리셋 이름 가져오기 ---
function _getCurrentPresetNameFromUI() {
    const DEBUG_PREFIX = `[${EXTENSION_NAME} - Preset Helper]`;
    let currentPresetName = null; // 기본값을 null로 변경
    try {
        const visiblePresetDiv = $('#respective-presets-block > div:not([style*="display: none"])');
        if (visiblePresetDiv.length === 1) {
            const presetSelect = visiblePresetDiv.find('select.text_pole');
            if (presetSelect.length === 1) {
                const selectedOption = presetSelect.find('option:selected');
                if (selectedOption.length === 1) {
                    currentPresetName = selectedOption.text();
                    if (!currentPresetName || currentPresetName.startsWith('---') || currentPresetName.startsWith('(')) {
                        currentPresetName = null;
                    }
                }
            } else {
                console.error(`${DEBUG_PREFIX} Error: Found ${presetSelect.length} select.text_pole elements.`);
            }
        } else {
             console.error(`${DEBUG_PREFIX} Error: Found ${visiblePresetDiv.length} visible preset divs.`);
        }
    } catch (error) {
        console.error(`${DEBUG_PREFIX} Error extracting preset name:`, error);
        currentPresetName = null;
    }
    // if (currentPresetName === null) console.log(`${DEBUG_PREFIX} Could not get a valid preset name.`);
    return currentPresetName;
}

// --- Helper 함수: 현재 선택된 API가 Text Completion인지 확인 ---
function _isTextCompletionSelected() {
    const DEBUG_PREFIX = `[${EXTENSION_NAME} - ApiCheck Helper]`;
    try {
        const $apiSelect = $('#main_api');
        if ($apiSelect.length === 1) {
            const selectedApiValue = $apiSelect.val();
            // 'textgenerationwebui' 값이 Text Completion API를 나타냅니다.
            return selectedApiValue === 'textgenerationwebui';
        } else {
            console.warn(`${DEBUG_PREFIX} Could not find API select element #main_api.`);
            return false;
        }
    } catch (error) {
        console.error(`${DEBUG_PREFIX} Error checking selected API:`, error);
        return false;
    }
}


// 디버그용 Helper 함수: 현재 UI에서 선택된 프롬프트 관련 데이터 취합 및 포맷
function _view_promptDataFromUI() {
    const DEBUG_PREFIX_VIEW = `[${EXTENSION_NAME} - ViewPromptData]`;
    try {
        const isTextComp = _isTextCompletionSelected();
        const generationPreset = _getCurrentPresetNameFromUI() || '(정보 없음)'; // null이면 대체 텍스트

        let outputString = `  - API Type: ${isTextComp ? 'Text Completion' : 'Other'}\n`;
        outputString += `  - Generation Preset: ${generationPreset}\n`;

        if (isTextComp) {
            const contextTemplate = _getSelectedContextTemplateName() || '(정보 없음)';
            const instructTemplate = _getSelectedInstructTemplateName() || '(정보 없음)';
            const systemPrompt = _getSelectedSystemPromptName(); // "None" 가능
            outputString += `  - Context Template: ${contextTemplate}\n`;
            outputString += `  - Instruct Template: ${instructTemplate}\n`;
            outputString += `  - System Prompt: ${systemPrompt !== null ? systemPrompt : '(정보 없음)'}`; // null일 때만 대체
        }

        return outputString;

    } catch (error) {
        console.error(`${DEBUG_PREFIX_VIEW} Error gathering prompt data from UI:`, error);
        return "  Error retrieving prompt data. Check console for details.";
    }
}

// --- Helper 함수: 메시지/스와이프의 send_date와 model 이름을 조합하여 정규화된 키 생성 ---
function _createSwipeKey(sendDate, modelName) {
    if (!sendDate) {
        return null;
    }
    const normalizedSendDate = String(sendDate).replace(/\s+/g, '').toLowerCase();
    const normalizedModelName = (modelName || 'unknown').toLowerCase();
    const key = `${normalizedSendDate}_model_${normalizedModelName}`;
    return key;
}

// --- Helper 함수: 데이터 소스와 UI 상태 기반으로 저장할 프리셋 정보 객체 수집 및 형식화 ---
function _collectAndFormatPresetData(dataSource) {
    const DEBUG_PREFIX_COLLECT = `[${EXTENSION_NAME} - CollectData]`;
    if (!dataSource) {
        console.warn(`${DEBUG_PREFIX_COLLECT} dataSource is missing.`);
        return null;
    }

    const valueObject = {};
    const isTextComp = _isTextCompletionSelected();

    // 1. Generation Preset (항상 시도)
    const genPresetName = _getCurrentPresetNameFromUI();
    if (genPresetName) { // null이 아닐 때만 추가
        valueObject.genPreset = genPresetName;
    } else {
        // console.log(`${DEBUG_PREFIX_COLLECT} Failed to get valid Generation Preset name.`);
    }

    // 2. Text Completion 상세 정보 (Text Completion API 일 때만 시도)
    if (isTextComp) {
        const ctxTplName = _getSelectedContextTemplateName();
        if (ctxTplName) {
            valueObject.ctxTpl = ctxTplName;
        } else {
            // console.log(`${DEBUG_PREFIX_COLLECT} Failed to get valid Context Template name.`);
        }

        const insTplName = _getSelectedInstructTemplateName();
        if (insTplName) {
            valueObject.insTpl = insTplName;
        } else {
            // console.log(`${DEBUG_PREFIX_COLLECT} Failed to get valid Instruct Template name.`);
        }

        const sysPptName = _getSelectedSystemPromptName();
        // System Prompt는 "None"도 유효하므로 null이 아닐 때만 추가 (빈 문자열은 보통 없음)
        if (sysPptName !== null) {
             valueObject.sysPpt = sysPptName;
        } else {
            // console.log(`${DEBUG_PREFIX_COLLECT} Failed to get valid System Prompt name.`);
        }
    }

    // 3. 최종 객체 유효성 확인 (하나 이상의 유효한 속성이 있는지)
    if (Object.keys(valueObject).length > 0) {
        // console.log(`${DEBUG_PREFIX_COLLECT} Collected data:`, valueObject);
        return valueObject;
    } else {
        console.warn(`${DEBUG_PREFIX_COLLECT} No valid preset/template information could be collected.`);
        return null; // 유효한 정보가 하나도 없으면 null 반환
    }
}


// --- Helper 함수 끝 ---

// 상태 리셋 함수: 채팅 변경 시 호출되어 설정 재로드
function resetState() {
    loadSettings();
}

// 메타데이터 저장 함수: 수집된 최신 프리셋 정보를 메타데이터에 조건부 저장
function saveState() {
    const DEBUG_PREFIX_SAVE = `[${EXTENSION_NAME} - SaveState]`;
    const context = globalThis.SillyTavern.getContext();
    if (!context || !context.chatMetadata) {
        console.error(`${DEBUG_PREFIX_SAVE} Critical Error: Context or chatMetadata is not available! Aborting saveState.`);
        return;
    }
    const chatMetadata = context.chatMetadata;
    let targetMetadata = chatMetadata[METADATA_KEY];

    if (typeof targetMetadata !== 'object' || targetMetadata === null) {
        targetMetadata = {};
        chatMetadata[METADATA_KEY] = targetMetadata;
    }

    const newKey = latestPresetInfo.key;
    const newValueObject = latestPresetInfo.value; // 이제 항상 객체 또는 null

    // 키와 값 객체가 모두 유효할 때만 저장 시도
    if (newKey && typeof newKey === 'string' && newKey.trim() !== '' && newValueObject && typeof newValueObject === 'object') {
        if (!targetMetadata.hasOwnProperty(newKey)) {
            targetMetadata[newKey] = newValueObject; // 새 객체 저장
            // console.log(`${DEBUG_PREFIX_SAVE} Added new preset info object for key "${newKey}":`, newValueObject);
        } else {
            // console.log(`${DEBUG_PREFIX_SAVE} Key "${newKey}" already exists. Skipping addition.`);
        }
    } else {
        // console.log(`${DEBUG_PREFIX_SAVE} Invalid key ("${newKey}") or value object (${JSON.stringify(newValueObject)}). Skipping save.`);
    }

    saveMetadataDebounced(); // 변경 여부와 관계없이 호출 (Debounce가 처리)
}

// 설정 로드 함수: 확장 로드 시 또는 채팅 변경 시 호출
function loadSettings() {
    const DEBUG_PREFIX_LOAD = `[${EXTENSION_NAME} - LoadSettings]`;
    const context = getContext(); // Use local getContext if available

    if (!context) {
        console.error(`${DEBUG_PREFIX_LOAD} Critical Error: Context is not available! Aborting loadSettings.`);
        return;
    }

    // Ensure global chatMetadata exists
    const globalContext = globalThis.SillyTavern.getContext();
    if (!globalContext.chatMetadata) {
         console.warn(`${DEBUG_PREFIX_LOAD} globalContext.chatMetadata is initially undefined/null. Initializing as {}.`);
         globalContext.chatMetadata = {};
    }
    const currentChatMetadata = globalContext.chatMetadata;

    latestPresetInfo = { key: null, value: null }; // Reset temporary storage

    if (typeof METADATA_KEY === 'undefined') {
        console.error(`${DEBUG_PREFIX_LOAD} Critical Error: METADATA_KEY is not defined! Aborting metadata load.`);
        return;
    }

    // Ensure metadata storage for this extension exists and is an object
    if (!(METADATA_KEY in currentChatMetadata) || typeof currentChatMetadata[METADATA_KEY] !== 'object' || currentChatMetadata[METADATA_KEY] === null) {
        currentChatMetadata[METADATA_KEY] = {};
        console.log(`${DEBUG_PREFIX_LOAD} Initialized metadata storage at key: ${METADATA_KEY}`);
    }

	console.log(`${DEBUG_PREFIX_LOAD} Settings load complete for ${EXTENSION_NAME}.`);
}


/**
 * Preset Tracker Enhanced: 메타데이터에서 불필요 프리셋 데이터 정리
 * 현재 채팅 기록(메시지 및 스와이프)에 존재하지 않는 프리셋 정보를 삭제합니다.
 * @returns {Promise<string>} 작업 결과를 나타내는 문자열 메시지
 */
async function _cleanupOrphanPresetData() {
    const DEBUG_PREFIX_CLEANUP = `[${EXTENSION_NAME} - Cleanup]`;

    if (isCleaningInProgress) {
        console.warn(`${DEBUG_PREFIX_CLEANUP} Cleanup already in progress.`);
        toastr.warning('이미 정리 작업이 진행 중입니다.');
        return '정리 작업이 이미 진행 중입니다.';
    }

    try {
        isCleaningInProgress = true;
        const context = globalThis.SillyTavern.getContext();
        if (!context || !context.chat || !context.chatMetadata) {
            console.error(`${DEBUG_PREFIX_CLEANUP} Critical error: Context, chat, or chatMetadata not available.`);
            toastr.error('정리 작업 실패: 필수 데이터를 로드할 수 없습니다.');
            return '정리 작업 실패: 필수 데이터 로드 불가.';
        }

        const presetStorage = context.chatMetadata[METADATA_KEY];

        if (!presetStorage || typeof presetStorage !== 'object' || Object.keys(presetStorage).length === 0) {
            toastr.info('정리할 프리셋 데이터가 없습니다.');
            return '정리할 프리셋 데이터가 없습니다.';
        }

        const validKeys = new Set();
        for (const message of context.chat) {
            if (message.is_user || message.is_system) continue;

            let baseKey = _createSwipeKey(message.send_date, message.extra?.model);
            if (baseKey) validKeys.add(baseKey);

            if (Array.isArray(message.swipe_info)) {
                for (const swipe of message.swipe_info) {
                    if (swipe) {
                        let swipeKey = _createSwipeKey(swipe.send_date, swipe.extra?.model);
                        if (swipeKey) validKeys.add(swipeKey);
                    }
                }
            }
        }

        let deletedCount = 0;
        const metadataKeys = Object.keys(presetStorage);
        for (const metadataKey of metadataKeys) {
            if (!validKeys.has(metadataKey)) {
                // console.log(`${DEBUG_PREFIX_CLEANUP} Deleting orphan key: ${metadataKey} (Value type: ${typeof presetStorage[metadataKey]})`);
                delete presetStorage[metadataKey];
                deletedCount++;
            }
        }

        let feedbackMessage;
        if (deletedCount > 0) {
            saveMetadataDebounced();
            feedbackMessage = `${deletedCount}개의 사용하지 않는 프리셋 정보가 정리되었습니다.`;
            toastr.success(feedbackMessage);
        } else {
            feedbackMessage = '사용하지 않는 프리셋 정보가 없어 정리할 내용이 없습니다.';
            toastr.info(feedbackMessage);
        }
        return feedbackMessage;

    } catch (error) {
        console.error(`${DEBUG_PREFIX_CLEANUP} Error during cleanup process:`, error);
        toastr.error('데이터 정리 중 오류가 발생했습니다. 콘솔 로그를 확인하세요.');
        return '데이터 정리 중 오류 발생.';
    } finally {
        isCleaningInProgress = false;
    }
}

/**
 * Preset Tracker Enhanced: 레거시 문자열 데이터를 새 객체 형식으로 마이그레이션
 * @returns {Promise<string>} 작업 결과를 나타내는 문자열 메시지
 */
async function _migrateLegacyPresetData() {
    const DEBUG_PREFIX_MIGRATE = `[${EXTENSION_NAME} - Migrate]`;
    try {
        console.log(`${DEBUG_PREFIX_MIGRATE} Starting legacy data migration...`);
        const context = globalThis.SillyTavern.getContext();
        if (!context || !context.chatMetadata) {
            console.error(`${DEBUG_PREFIX_MIGRATE} Critical error: Context or chatMetadata not available.`);
            toastr.error('마이그레이션 실패: 필수 데이터를 로드할 수 없습니다.');
            return '마이그레이션 실패: 필수 데이터 로드 불가.';
        }

        const presetStorage = context.chatMetadata[METADATA_KEY];

        if (!presetStorage || typeof presetStorage !== 'object' || Object.keys(presetStorage).length === 0) {
            console.log(`${DEBUG_PREFIX_MIGRATE} No preset data found to migrate.`);
            toastr.info('마이그레이션할 레거시 데이터가 없습니다.');
            return '마이그레이션할 레거시 데이터가 없습니다.';
        }

        let convertedCount = 0;
        const keysToMigrate = Object.keys(presetStorage);
        // console.log(`${DEBUG_PREFIX_MIGRATE} Checking ${keysToMigrate.length} entries...`);

        for (const key of keysToMigrate) {
            const value = presetStorage[key];
            // 값이 문자열인 경우만 마이그레이션 대상
            if (typeof value === 'string') {
                // console.log(`${DEBUG_PREFIX_MIGRATE} Migrating key: ${key}, value: "${value}"`);
                presetStorage[key] = { genPreset: value }; // 새 객체 형식으로 변환
                convertedCount++;
            }
        }

        let feedbackMessage;
        if (convertedCount > 0) {
            console.log(`${DEBUG_PREFIX_MIGRATE} Migrated ${convertedCount} legacy entries. Saving metadata...`);
            saveMetadataDebounced(); // 변경 사항 저장
            feedbackMessage = `${convertedCount}개의 레거시 프리셋 데이터가 새로운 형식으로 변환되었습니다.`;
            toastr.success(feedbackMessage);
        } else {
            console.log(`${DEBUG_PREFIX_MIGRATE} No legacy string data found to migrate.`);
            feedbackMessage = '변환할 레거시 데이터가 없습니다.';
            toastr.info(feedbackMessage);
        }
        return feedbackMessage; // 슬래시 커맨드 결과 반환

    } catch (error) {
        console.error(`${DEBUG_PREFIX_MIGRATE} Error during migration process:`, error);
        toastr.error('데이터 마이그레이션 중 오류가 발생했습니다. 콘솔 로그를 확인하세요.');
        return '데이터 마이그레이션 중 오류 발생.'; // 슬래시 커맨드 결과 반환
    }
}


// jQuery Ready 함수: 문서 로딩 완료 후 실행
jQuery(async () => {
    console.log(`[${EXTENSION_NAME}] Extension Loading...`);
    loadSettings();

    // 초기 UI 상태 확인 (디버그용)
    // console.log(`[${EXTENSION_NAME}] Initial Prompt Settings Check:\n${_view_promptDataFromUI()}`);

    // --- 설정 페이지 HTML 로드 및 추가 ---
    try {
        const settingsHtml = await renderExtensionTemplateAsync(`third-party/${EXTENSION_NAME}`, 'settings');
        const container = $('#extensions_settings');
        if (container.length > 0) {
            container.append(settingsHtml);
            // console.log(`[${EXTENSION_NAME}] Settings HTML loaded into #extensions_settings.`);
        } else {
            console.warn(`[${EXTENSION_NAME}] Could not find container #extensions_settings.`);
        }
    } catch (error) {
        console.error(`[${EXTENSION_NAME}] Error loading or appending settings HTML:`, error);
    }

    // --- SillyTavern 이벤트 리스너 등록 ---

    eventSource.on(event_types.CHAT_CHANGED, () => {
        console.log(`[${EXTENSION_NAME}] Chat changed, resetting state.`);
        resetState();
    });

    // 새 메시지 수신 시: 프리셋 정보 수집 및 저장 시도 (수정됨)
    eventSource.on(event_types.MESSAGE_RECEIVED, async (msgId) => {
        const DEBUG_PREFIX_MSG = `[${EXTENSION_NAME} - Msg Rcvd]`;
        // console.log(`\n${DEBUG_PREFIX_MSG} === Handler Start === MsgId: ${msgId}`);

        let collectedAndSaved = false; // 플래그 이름 변경
        try {
            const context = getContext();
            if (!context || !context.chat || context.chat.length === 0) {
                // console.warn(`${DEBUG_PREFIX_MSG} Invalid context or empty chat.`);
                return;
            }

            // 마지막 AI 메시지 식별 (기존 로직과 유사)
            let messageIndex = context.chat.length - 1;
            let message = context.chat[messageIndex];
            if (message && message.is_user && messageIndex > 0) {
                 messageIndex--;
                 message = context.chat[messageIndex];
            }

            // 식별된 메시지가 AI 메시지일 경우 처리
            if (message && !message.is_user && !message.is_system) {
                const currentIndex = message.swipe_id ?? 0;
                let currentSwipeData = message;
                if (Array.isArray(message.swipe_info) && currentIndex >= 0 && currentIndex < message.swipe_info.length && message.swipe_info[currentIndex]) {
                    currentSwipeData = message.swipe_info[currentIndex];
                }

                const sendDate = currentSwipeData?.send_date;
                const modelName = currentSwipeData?.extra?.model;
                const generatedKey = _createSwipeKey(sendDate, modelName);

                if (generatedKey) {
                    // 데이터 수집 및 형식화 함수 호출
                    const valueObject = _collectAndFormatPresetData(currentSwipeData);

                    // 유효한 객체가 반환되었을 경우 임시 변수 업데이트
                    if (valueObject) {
                        latestPresetInfo = { key: generatedKey, value: valueObject };
                        collectedAndSaved = true; // 성공 플래그 설정
                        // console.log(`${DEBUG_PREFIX_MSG} Prepared data for key "${generatedKey}":`, valueObject);
                        saveState(); // 즉시 저장 시도 (Debounced)
                    } else {
                         // console.log(`${DEBUG_PREFIX_MSG} No valid data collected for key "${generatedKey}". Skipping save.`);
                    }
                } else {
                    // console.log(`${DEBUG_PREFIX_MSG} Key generation failed. Skipping collection.`);
                }
            } else {
                 // console.log(`${DEBUG_PREFIX_MSG} Last message is not a processable AI message.`);
            }
        } catch (error) {
            console.error(`${DEBUG_PREFIX_MSG} Error during preset info processing:`, error);
        }

        // if (!collectedAndSaved) {
        //     console.log(`${DEBUG_PREFIX_MSG} No preset info was collected or saved.`);
        // }
        // console.log(`${DEBUG_PREFIX_MSG} === Handler End === MsgId: ${msgId}\n`);
    });

    // --- UI 요소 이벤트 리스너 등록 ---

    // 캐릭터 이름 클릭 시: 모델/프리셋 정보 표시 (수정됨 - Text Comp 분기 명확화)
    $(document).off(`click.${EXTENSION_NAME}`, '#chat .mes .name_text'); 
    $(document).on(`click.${EXTENSION_NAME}`, '#chat .mes .name_text', async function (e) {
        e.preventDefault(); // 기본 동작 방지
        e.stopPropagation(); // 이벤트 버블링 방지

        const nameTextElement = $(this);
        const messageElement = nameTextElement.closest('.mes'); // 클릭된 이름이 속한 메시지 요소 찾기
        const messageId = messageElement.attr('mesid');         // 메시지 ID 속성 가져오기
        const DEBUG_PREFIX_CLICK = `[${EXTENSION_NAME} Click]`;

        // 메시지 ID 없으면 경고 후 종료
        if (messageId === undefined) {
            console.warn(`${DEBUG_PREFIX_CLICK} Could not find message ID for clicked name text.`);
            return;
        }

        try {
            const context = globalThis.SillyTavern.getContext();
            // 컨텍스트, 채팅 기록, 메타데이터 유효성 검사
            if (!context || !context.chat || !context.chatMetadata) {
                console.warn(`${DEBUG_PREFIX_CLICK} Global Context, chat, or chatMetadata not available.`);
                return;
            }

            // 메시지 ID를 정수로 변환하고 유효 범위 확인
            const msgIndex = parseInt(messageId);
            if (isNaN(msgIndex) || msgIndex < 0 || msgIndex >= context.chat.length) {
                console.warn(`${DEBUG_PREFIX_CLICK} Invalid message index: ${messageId}`);
                return;
            }

            // 해당 인덱스의 메시지 객체 가져오기
            const message = context.chat[msgIndex];
            // 메시지 객체가 없으면 오류 처리 후 종료
            if (!message) {
                console.error(`${DEBUG_PREFIX_CLICK} Message object is MISSING for ID: ${messageId}.`);
                return;
            }

            // 사용자 메시지 또는 시스템 메시지 클릭 시 조용히 종료 (정보 표시 X)
            if (message.is_user || message.is_system) {
                 // console.log(`${DEBUG_PREFIX_CLICK} Clicked on user/system message (${messageId}). Aborting display.`);
                 return;
            }

            // --- 이하 로직은 AI 메시지에 대해서만 실행됨 ---

            // 현재 활성화된 스와이프 정보 가져오기 (없으면 메시지 자체 사용)
            const currentSwipeIndex = message.swipe_id ?? 0;
            let activeDataSource = message; // 기본 데이터 소스
            let toastSwipeText = ""; // Toastr 제목에 추가할 스와이프 정보

            // 유효한 스와이프 정보가 있을 경우 데이터 소스 및 텍스트 업데이트
            if (Array.isArray(message.swipe_info) &&
                currentSwipeIndex >= 0 &&
                currentSwipeIndex < message.swipe_info.length &&
                message.swipe_info[currentSwipeIndex])
            {
                activeDataSource = message.swipe_info[currentSwipeIndex];
                toastSwipeText = ` (스와이프 ${currentSwipeIndex + 1})`; // 예: " (스와이프 3)"
            } else if (Array.isArray(message.swipe_info)) {
                // 스와이프 배열은 있지만 인덱스가 잘못된 경우 로그 (선택적)
                 // console.log(`${DEBUG_PREFIX_CLICK} Using message itself (invalid swipe index ${currentSwipeIndex}) for message ID: ${messageId}`);
            }

            // 1. 모델 이름 가져오기 (activeDataSource에서)
            const modelName = activeDataSource?.extra?.model || '(모델 정보 없음)';

            // 2. 프리셋/템플릿 정보 조회 준비
            const sendDate = activeDataSource?.send_date;
            const modelNameToUse = activeDataSource?.extra?.model; // 조회용 키 생성에 사용할 모델 이름
            const lookupKey = _createSwipeKey(sendDate, modelNameToUse); // 조회용 키 생성 시도

			let displayTimeoutMs = 5000; // 기본 타임아웃: 5초 (Non-Text Comp, 레거시, 정보 없음 용)
            let toastTitle = `메시지 #${messageId}${toastSwipeText} 정보`;
            let toastContentHtml = `<br><strong>모델:</strong><br>${modelName}<br><br>`; // 기본 모델 정보 항상 표시
            let storedValue = null;

            // 메타데이터에서 저장된 값 조회
            if (lookupKey && context.chatMetadata[METADATA_KEY]) {
                storedValue = context.chatMetadata[METADATA_KEY][lookupKey];
            }

            // --- 데이터 타입 및 내용에 따라 표시 내용 구성 ---
            if (storedValue && typeof storedValue === 'object') {
                // --- 최신 객체 데이터 처리 ---
                const isTextCompletionData = storedValue.hasOwnProperty('ctxTpl') || storedValue.hasOwnProperty('insTpl') || storedValue.hasOwnProperty('sysPpt');

                if (isTextCompletionData) {
                    // --- Text Completion 데이터 표시 로직 ---
					displayTimeoutMs = 9000; // Text Completion은 9초로 설정 변경!
                    toastContentHtml += `<strong>프롬프트 (Text Completion) :</strong><br>`;
                    const missingKeys = [];

                    // Generation Preset (단순 이름 역할)
                    if (storedValue.hasOwnProperty('genPreset')) {
                        toastContentHtml += `  - Preset : ${storedValue.genPreset}<br>`;
                    } else {
                        toastContentHtml += `  - Preset : (정보 없음)<br>`;
                        // genPreset 누락은 여전히 문제일 수 있음
                        console.error(`${DEBUG_PREFIX_CLICK} Potential Issue: 'genPreset' key missing in Text Completion object for key ${lookupKey}!`, storedValue);
                        missingKeys.push('genPreset'); // 이것도 누락으로 간주
                    }

                    //toastContentHtml += `  --- 주요 프롬프트 ---<br>`; // 주요 프롬프트 구분

                    // Instruct Template (주요 프롬프트 1)
                    if (storedValue.hasOwnProperty('insTpl')) {
                        toastContentHtml += `  - Instruct Template: ${storedValue.insTpl}<br>`;
                    } else {
                        toastContentHtml += `  - Instruct Template: (정보 없음)<br>`;
                        missingKeys.push('insTpl');
                    }
                    // System Prompt (주요 프롬프트 2)
                    if (storedValue.hasOwnProperty('sysPpt')) {
                        toastContentHtml += `  - System Prompt: ${storedValue.sysPpt}<br>`;
                    } else {
                        toastContentHtml += `  - System Prompt: (정보 없음)<br>`;
                        missingKeys.push('sysPpt');
                    }
                     // Context Template (부가 정보)
					 //현재는 생략
					 /*
                    if (storedValue.hasOwnProperty('ctxTpl')) {
                        toastContentHtml += `  - Context Template: ${storedValue.ctxTpl}<br>`;
                    } else {
                        toastContentHtml += `  - Context Template: (정보 없음)<br>`;
                        missingKeys.push('ctxTpl');
                    }
					*/

                    // Text Completion 데이터인데 누락된 키가 있으면 경고 로그
                    if (missingKeys.length > 0) {
                        console.warn(`${DEBUG_PREFIX_CLICK} Text Completion data for key ${lookupKey} is missing expected keys: [${missingKeys.join(', ')}]`, storedValue);
                    }

                } else {
                    // --- Non-Text Completion 데이터 표시 로직 (대표적으로 Chat Completion) ---
                    toastContentHtml += `<strong>프롬프트 :</strong><br>`; // 다른 제목 사용

                    // genPreset이 핵심 정보
                    if (storedValue.hasOwnProperty('genPreset')) {
                        // 여기서는 레이블 없이 값만 강조해서 보여주는 것이 의미 전달에 더 좋을 수 있음
                        toastContentHtml += `  ${storedValue.genPreset}<br>`;
                        // 또는 명시적 레이블 사용:
                        // toastContentHtml += `  - Preset/Prompt: ${storedValue.genPreset}<br>`;
                    } else {
                        // Non-Text Comp 객체인데 genPreset이 없으면 심각한 오류
                        toastContentHtml += `  (프리셋 정보 없음 - 저장 오류)<br>`;
                        console.error(`${DEBUG_PREFIX_CLICK} Critical: 'genPreset' key missing in non-Text Completion object for key ${lookupKey}!`, storedValue);
                    }
                    // 다른 필드는 이 API 타입에서는 의미가 없으므로 표시하지 않음
                }

                    toastContentHtml += `<br>`;
            } else if (typeof storedValue === 'string') {
                // --- 레거시 문자열 데이터 처리 ---
                toastContentHtml += `<strong>레거시 :</strong><br>이전 버전 데이터입니다. 최신 정보를 보려면 마이그레이션이 필요합니다.<br>명령어: <code>/pteMigratePresetData</code>`;
                // 디버그용 콘솔 로그 (값 확인용)
                console.log(`[${DEBUG_PREFIX_CLICK} - Legacy] MsgID ${messageId}, Key ${lookupKey}, Value: "${storedValue}"`);

            } else {
                // --- 저장된 정보 없음 ---
                toastContentHtml += `<strong>사용 설정:</strong><br>(저장된 프리셋/템플릿 정보 없음)`;
                // 키는 있는데 값이 null, undefined 등이거나, 키 자체가 없는 경우
                // console.log(`${DEBUG_PREFIX_CLICK} No preset/template info found for key ${lookupKey}`);
            }

            // 3. Toastr 알림으로 정보 표시
            // Toastr 옵션 설정
            const toastOptions = {
                "closeButton": true,
                "progressBar": true,
                "positionClass": "toast-top-center", // 화면 상단 중앙
				"timeOut": String(displayTimeoutMs), // 결정된 타임아웃 값 사용 (문자열로)
                "extendedTimeOut": "2000", // 마우스 오버 시 추가 표시 시간
                "escapeHtml": false // HTML 태그 사용 허용 (<code> 등)
            };

            // Toastr 라이브러리가 로드되었는지 확인 후 알림 표시
            if (typeof toastr === 'object' && typeof toastr.info === 'function') {
                toastr.info(toastContentHtml, toastTitle, toastOptions);
            } else {
                // Toastr 없으면 콘솔에만 오류 기록 (Fallback alert 제거)
                // 콘솔 출력을 위해 HTML 태그를 간단히 제거하거나 줄바꿈으로 변경
                const consoleContent = toastContentHtml.replace(/<br>/g, '\n')
                                                     .replace(/<strong>(.*?)<\/strong>/g, '$1') // strong 태그 제거
                                                     .replace(/<code>(.*?)<\/code>/g, '$1')   // code 태그 제거
                                                     .replace(/<.*?>/g, ''); // 나머지 태그 제거
                console.error(`${DEBUG_PREFIX_CLICK} Toastr object is not available. Title: ${toastTitle}, Content:\n${consoleContent}`);
            }

        } catch (error) {
            // 이름 클릭 처리 중 예외 발생 시 에러 로그 및 알림
            console.error(`${DEBUG_PREFIX_CLICK} Unexpected error displaying info for message ID ${messageId} (name click):`, error);
            if (typeof toastr === 'object' && typeof toastr.error === 'function') {
                toastr.error('정보를 표시하는 중 예상치 못한 오류가 발생했습니다.');
            }
        }
    }); // end of click handler

});





// --- 슬래시 커맨드 등록 ---
SlashCommandParser.addCommandObject(SlashCommand.fromProps({
	name: 'pteCleanOrphanData',
	callback: _cleanupOrphanPresetData,
	helpString: 'Preset Tracker Enhanced: 사용하지 않는 프리셋 기록(불필요 데이터)을 정리합니다.',
	returns: '정리된 항목 수를 포함한 결과 메시지를 반환합니다.'
}));

// 신규 마이그레이션 커맨드 등록
SlashCommandParser.addCommandObject(SlashCommand.fromProps({
	name: 'pteMigratePresetData',
	callback: _migrateLegacyPresetData,
	helpString: 'Preset Tracker Enhanced: Beta1 버전의 데이터를 이후 버전으로 마이그레이션합니다 (이 작업은 채팅방마다 수행해주어야합니다)',
	returns: '변환된 항목 수를 포함한 결과 메시지를 반환합니다.'
}));

console.log(`[${EXTENSION_NAME}] Event Listeners & Slash Commands Registered.`);
console.log(`[${EXTENSION_NAME}] Extension Loaded Successfully.`);
