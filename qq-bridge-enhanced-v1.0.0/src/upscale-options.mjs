export function validateUpscaleOptions(config){
 if(config?.version!==1||config.model!=='4x_IllustrationJaNai_V3detail_DAT2_28k_bf16.safetensors'||![128,256].includes(config.tile)||!['full-first','tiled'].includes(config.processing))throw Error('高清配置无效：processing须为full-first或tiled，tile须为128或256');
 return config;
}
