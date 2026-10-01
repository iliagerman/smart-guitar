"""BTC chord recognition model (inference only).

Bi-directional Transformer for Chord recognition, Park et al., ISMIR 2019.
Adapted from https://github.com/jayg996/BTC-ISMIR19 (MIT License,
Copyright (c) 2019 Jonggwon Park), trimmed to what inference needs. Module
and parameter names match the published checkpoint, so its state dict loads
as is.
"""

from __future__ import annotations

import math

import numpy as np
import torch
from torch import nn

# The published large-vocabulary checkpoint's hyperparameters.
FEATURE_SIZE = 144
TIMESTEP = 108
HIDDEN_SIZE = 128
NUM_LAYERS = 8
NUM_HEADS = 4
NUM_CHORDS = 170


def _bias_mask(length: int) -> torch.Tensor:
    mask = np.triu(np.full([length, length], -np.inf), 1)
    return torch.from_numpy(mask).float().unsqueeze(0).unsqueeze(1)


def _timing_signal(length: int, channels: int) -> torch.Tensor:
    timescales = channels // 2
    increment = math.log(1.0e4) / (timescales - 1)
    inv = np.exp(np.arange(timescales, dtype=np.float64) * -increment)
    scaled = np.arange(length)[:, None] * inv[None, :]
    signal = np.concatenate([np.sin(scaled), np.cos(scaled)], axis=1)
    return torch.from_numpy(signal.reshape(1, length, channels)).float()


class LayerNorm(nn.Module):
    def __init__(self, features: int, eps: float = 1e-6):
        super().__init__()
        self.gamma = nn.Parameter(torch.ones(features))
        self.beta = nn.Parameter(torch.zeros(features))
        self.eps = eps

    def forward(self, x):
        mean = x.mean(-1, keepdim=True)
        std = x.std(-1, keepdim=True)
        return self.gamma * (x - mean) / (std + self.eps) + self.beta


class MultiHeadAttention(nn.Module):
    def __init__(self, depth: int, num_heads: int, bias_mask: torch.Tensor):
        super().__init__()
        self.num_heads = num_heads
        self.query_scale = (depth // num_heads) ** -0.5
        self.bias_mask = bias_mask
        self.query_linear = nn.Linear(depth, depth, bias=False)
        self.key_linear = nn.Linear(depth, depth, bias=False)
        self.value_linear = nn.Linear(depth, depth, bias=False)
        self.output_linear = nn.Linear(depth, depth, bias=False)

    def _split(self, x):
        b, t, d = x.shape
        return x.view(b, t, self.num_heads, d // self.num_heads).permute(0, 2, 1, 3)

    def forward(self, x):
        q = self._split(self.query_linear(x)) * self.query_scale
        k = self._split(self.key_linear(x))
        v = self._split(self.value_linear(x))
        logits = torch.matmul(q, k.permute(0, 1, 3, 2))
        logits = logits + self.bias_mask[:, :, : logits.shape[-2], : logits.shape[-1]]
        context = torch.matmul(torch.softmax(logits, dim=-1), v)
        b, h, t, d = context.shape
        return self.output_linear(context.permute(0, 2, 1, 3).contiguous().view(b, t, h * d))


class Conv(nn.Module):
    def __init__(self, input_size: int, output_size: int):
        super().__init__()
        self.pad = nn.ConstantPad1d((1, 1), 0)
        self.conv = nn.Conv1d(input_size, output_size, kernel_size=3)

    def forward(self, x):
        return self.conv(self.pad(x.permute(0, 2, 1))).permute(0, 2, 1)


class PositionwiseFeedForward(nn.Module):
    def __init__(self, depth: int):
        super().__init__()
        self.layers = nn.ModuleList([Conv(depth, depth), Conv(depth, depth)])

    def forward(self, x):
        for layer in self.layers:
            x = torch.relu(layer(x))
        return x


class SelfAttentionBlock(nn.Module):
    def __init__(self, depth: int, num_heads: int, bias_mask: torch.Tensor):
        super().__init__()
        self.multi_head_attention = MultiHeadAttention(depth, num_heads, bias_mask)
        self.positionwise_convolution = PositionwiseFeedForward(depth)
        self.layer_norm_mha = LayerNorm(depth)
        self.layer_norm_ffn = LayerNorm(depth)

    def forward(self, x):
        x = x + self.multi_head_attention(self.layer_norm_mha(x))
        return x + self.positionwise_convolution(self.layer_norm_ffn(x))


class BiDirectionalSelfAttention(nn.Module):
    def __init__(self, depth: int, num_heads: int, length: int):
        super().__init__()
        mask = _bias_mask(length)
        self.attn_block = SelfAttentionBlock(depth, num_heads, mask)
        self.backward_attn_block = SelfAttentionBlock(depth, num_heads, mask.transpose(2, 3))
        self.linear = nn.Linear(depth * 2, depth)

    def forward(self, x):
        return self.linear(torch.cat((self.attn_block(x), self.backward_attn_block(x)), dim=2))


class SelfAttentionLayers(nn.Module):
    def __init__(self):
        super().__init__()
        self.timing_signal = _timing_signal(TIMESTEP, HIDDEN_SIZE)
        self.embedding_proj = nn.Linear(FEATURE_SIZE, HIDDEN_SIZE, bias=False)
        self.self_attn_layers = nn.Sequential(
            *[BiDirectionalSelfAttention(HIDDEN_SIZE, NUM_HEADS, TIMESTEP) for _ in range(NUM_LAYERS)]
        )
        self.layer_norm = LayerNorm(HIDDEN_SIZE)

    def forward(self, x):
        x = self.embedding_proj(x) + self.timing_signal[:, : x.shape[1], :]
        return self.layer_norm(self.self_attn_layers(x))


class OutputLayer(nn.Module):
    def __init__(self):
        super().__init__()
        self.output_projection = nn.Linear(HIDDEN_SIZE, NUM_CHORDS)
        # In the checkpoint but unused by the softmax output.
        self.lstm = nn.LSTM(HIDDEN_SIZE, HIDDEN_SIZE // 2, batch_first=True, bidirectional=True)

    def forward(self, x):
        return self.output_projection(x)


class BTCModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.self_attn_layers = SelfAttentionLayers()
        self.output_layer = OutputLayer()

    def forward(self, x):
        """Chord logits for a (batch, TIMESTEP, FEATURE_SIZE) block of CQT frames."""
        return self.output_layer(self.self_attn_layers(x))
