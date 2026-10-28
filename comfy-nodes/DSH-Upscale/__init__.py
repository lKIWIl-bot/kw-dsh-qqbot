"""Selectable tiled or full-image super-resolution with bounded OOM fallback."""
import torch
import torch.nn.functional as F
import comfy.utils
from comfy import model_management

class DshIllustrationUpscale:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required":{"upscale_model":("UPSCALE_MODEL",),"image":("IMAGE",),"scale":("INT",{"default":2,"min":2,"max":4,"step":2}),"tile":("INT",{"default":256,"min":128,"max":256,"step":128}),"processing":(["tiled","full-first"],)}}
    RETURN_TYPES=("IMAGE",)
    FUNCTION="upscale"
    CATEGORY="DSH/upscale"

    def upscale(self,upscale_model,image,scale,tile=256,processing='tiled'):
        if scale not in (2,4) or tile not in (128,256) or image.shape[0]!=1:
            raise ValueError("高清任务须逐张处理，倍率2或4，分块128或256")
        if upscale_model.scale!=4:
            raise ValueError("高清配置需要原生4倍IllustrationJaNai模型")
        device=upscale_model.patcher.load_device
        if processing not in ('full-first','tiled'):raise ValueError('Unknown upscale processing mode')
        def process(part):
            result=upscale_model(part.float())
            if scale==2:
                result=F.interpolate(result,scale_factor=.5,mode="bicubic",align_corners=False,antialias=True)
            return result
        output=None;fallback=False
        if processing=='full-first':
            try:
                reserve=image.shape[1]*image.shape[2]*3*4*4*384+image.nelement()*4
                model_management.load_models_gpu([upscale_model.patcher],memory_required=reserve,force_full_load=True)
                output=process(image[...,:3].movedim(-1,1).to(device)).to(model_management.intermediate_device())
            except Exception as error:
                model_management.raise_non_oom(error)
                fallback=True
            if fallback:
                import gc
                gc.collect();model_management.soft_empty_cache()
        if output is None:
            reserve=(tile*tile*3)*4*4*384+image.nelement()*4
            model_management.load_models_gpu([upscale_model.patcher],memory_required=reserve,force_full_load=True)
            pixels=image[...,:3].movedim(-1,1).to(device)
            while True:
                try:
                    steps=comfy.utils.get_tiled_scale_steps(pixels.shape[3],pixels.shape[2],tile_x=tile,tile_y=tile,overlap=32)
                    output=comfy.utils.tiled_scale(pixels,process,tile_x=tile,tile_y=tile,overlap=32,upscale_amount=scale,pbar=comfy.utils.ProgressBar(steps),output_device=model_management.intermediate_device())
                    break
                except Exception as error:
                    model_management.raise_non_oom(error)
                    tile//=2
                    if tile<128:raise
        output=output.movedim(1,-1).clamp(0,1)
        if image.shape[-1]==4:
            alpha=F.interpolate(image[...,3:4].movedim(-1,1).to(output),size=output.shape[1:3],mode="bilinear",align_corners=False).movedim(1,-1)
            output=torch.cat((output,alpha),dim=-1)
        return {'ui':{'upscale':[{'processing':'tiled' if processing=='tiled' or fallback else 'full','fallback':fallback,'scale':scale}]},'result':(output,)}

NODE_CLASS_MAPPINGS={"DshIllustrationUpscale":DshIllustrationUpscale}
